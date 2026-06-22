# Drive 桌面 CLI 同步 v1 設計

## 目標

在 `@wspc/cli` 加入第一版安全的桌面 Drive 同步切片。

這個切片會把本機資料夾綁定到既有的 WSPC Drive library，並執行手動的一次性 whole-file sync。它不建立 library、不執行 watcher、不自動合併 conflict、不保留空目錄、不維護 operation queue，也不偵測 rename。

## 指令

### `wspc drive bind`

```bash
wspc drive bind --library <library_id> [path]
```

`bind` 會把本機資料夾連到既有的遠端 Drive library。這個名稱是刻意選的：它不會建立 server library。

行為：

- 將 `path` 或目前工作目錄解析成 sync root。
- 寫入本機 state 前，先呼叫 generated `drive_library_get` operation。
- 如果 auth、權限或 library lookup 失敗，非零結束且不寫入任何檔案。
- 建立 `.wspc-drive/state.json`，內容包含 schema version、library id、timestamps、空的 `entries`、空的 `conflicts`。
- 若既有 state file 已綁定到不同 library，拒絕覆寫。
- 若資料夾已綁定到同一個 library，印出目前 binding 並成功結束。
- 沿用既有 global output 行為；`--json` 應輸出 machine-readable binding result。

### `wspc drive sync once`

```bash
wspc drive sync once [path]
```

`sync once` 會執行一次完整資料夾掃描，並和一次完整遠端 manifest 比對。

行為：

- 從 `path` 或目前工作目錄讀取 `.wspc-drive/state.json`。
- 使用 exclusive create 取得 `.wspc-drive/sync.lock`。
- 掃描本機 regular files，排除 `.wspc-drive/`。
- 取得完整遠端 manifest，必要時追 cursor 直到完成。
- 對每個 path 決定 upload、download、delete、state-only update、state removal、conflict 或 local error。
- 每完成一個 path 的成功處理，就 atomic persist state。
- 如果任何 path 失敗，或仍有 unresolved conflict，process exit code 非 0。

## API 邊界

在 synced OpenAPI update 後執行 `npm run generate`，讓 Drive JSON operations 和 generated command stubs 存在。

JSON requests 使用 generated SDK operations：

- `drive_library_get`：用於 `drive bind` validation。
- `drive_manifest_get`：用於 remote manifest reads。
- `drive_file_delete`：用於 conditional remote delete。

Raw byte transfer 使用 handwritten `loadAuthedFetch` calls：

- `PUT /drive/libraries/{id}/files/content?path=...&expected_entry_version=...`
- `GET /drive/libraries/{id}/files/content?path=...`

這和既有 email attachment download pattern 一致：streaming payload 留在 handwritten code，JSON operations 走 generated code。

## 本機狀態

State 位於：

```text
.wspc-drive/state.json
```

Schema：

```json
{
  "schema_version": 1,
  "library_id": "lib_...",
  "created_at": "2026-06-21T00:00:00.000Z",
  "updated_at": "2026-06-21T00:00:00.000Z",
  "entries": {},
  "conflicts": {}
}
```

State 只保存 library binding 與 sync metadata。它絕不保存 access token、refresh token 或 API key。

每個 `entries[path]` 記錄該 path 最後一個安全 base：

- `entry_id`
- `entry_version`
- `current_version_id`
- `content_sha256`
- `size_bytes`
- `last_local_sha256`
- `last_synced_at`
- `status`

每個 `conflicts[path]` 記錄保守停車場狀態：

- `detected_at`
- `reason`
- `remote_entry_version`
- `remote_version_id`

State 寫入使用 `.wspc-drive/` 內的 temp file，flush 後 rename 成 `state.json`。讀取時忽略 temp files。

Sync lock 是 `.wspc-drive/sync.lock`。Fresh lock 代表其他 sync 仍在執行，必須以 `sync lock already exists` 失敗；超過 10 分鐘的 lock 視為保守的 stale lock，可先移除再重新用 exclusive create 取得 lock。

## Path 政策

Sync paths 是 normalized POSIX relative paths。

拒絕：

- absolute paths
- `..`
- empty segments
- NUL 或 control characters
- Windows drive prefixes
- UNC paths
- backslashes
- 超過 1024 bytes 的 UTF-8 path
- 超過 255 bytes 的 UTF-8 segment

永遠排除 `.wspc-drive/`。

包含 dotfiles 和 hidden files。跳過 symlinks 和 non-regular files。不保留 empty directories。

如果 local scan 發現兩個 paths 只有大小寫不同，標記 `LOCAL_PATH_CASE_CONFLICT`，且不 sync 這兩個 paths。如果 remote manifest 包含兩個本機 filesystem 無法同時表示的 paths，標記 `REMOTE_PATH_CASE_CONFLICT`，且不 download 這兩個 paths。

## 同步演算法

每次 `sync once` 都執行 full scan。

1. 讀取 local state。
2. 將 local files 掃描成 `{ path, sha256, size_bytes }`。
3. 取得完整 remote manifest。
4. 建立 `union(local paths, remote paths, state paths)`，並依 sorted order 處理 paths。
5. 對每個 path 選擇剛好一個 action。
6. 每完成一個成功的 path-level local 或 remote mutation，就 atomic persist state。

Decision table：

| Base state | Local | Remote | Action |
| --- | --- | --- | --- |
| none | exists | none | upload create with `expected_entry_version=0` |
| none | none | exists | download remote |
| none | exists | exists, same hash | create state only |
| none | exists | exists, different hash | conflict |
| exists, local unchanged | none | remote unchanged | delete remote |
| exists, local unchanged | exists | remote changed | download remote |
| exists, local unchanged | exists | none | delete local |
| exists, local deleted | none | remote unchanged | delete remote |
| exists, local deleted | none | remote changed | conflict |
| exists, local changed | exists | remote unchanged | upload update with state `entry_version` |
| exists, local changed | exists | remote changed | conflict |
| exists | none | none | remove state entry |

Rename 會被視為 old-path delete 加 new-path create。

只有當目前 local hash 等於 `last_local_sha256` 時，download 才能 overwrite local file。Upload update 必須使用最後一次成功 state 中的 `entry_version`，不能用同一輪失敗比較時從 manifest 看到的較新 version。

如果 upload 或 delete 回傳 `VERSION_CONFLICT`，記錄 conflict，且不修改 local file 或既有 base entry。

## Error Handling 與輸出

`drive bind` 在 login、auth、permission 或 library lookup 失敗時，非零結束且不寫入 state。

`drive sync once` 在以下狀況非零結束：

- 缺少 `.wspc-drive/state.json`
- fresh lock 已存在
- invalid local 或 remote path
- case-only path collision
- network、auth、rate-limit 或 server failure
- `VERSION_CONFLICT`
- unresolved conflict

已成功的 path changes 不 rollback。失敗 paths 保留先前 state，已完成 paths 保持 persisted。

Human output 應是 compact summary：uploaded、downloaded、deleted、unchanged、conflicts、errors。JSON output 應包含同樣 summary 加上 per-path results。Logs 不得包含 file contents、tokens、auth headers 或完整 raw response bodies。

## 測試

最小測試覆蓋：

- Command tests：`drive bind` 成功 validation/write、拒絕 mismatched existing binding、validation failure 不寫檔。
- State tests：atomic write、temp files ignored、schema guard、fresh lock rejection、stale lock recovery。
- Path/scanner tests：unsafe path rejection、symlink 與 non-regular skip、dotfile include、`.wspc-drive/` exclude、case collision detection。
- 一個 table-driven decision test，覆蓋 sync table 每一列。
- API-boundary tests：證明 library validation、manifest、delete 使用 generated JSON calls，而 upload、download 使用 direct fetch。
- Conflict tests：證明 `VERSION_CONFLICT` 會記錄 conflict，且不 mutate base state。
- Disk-write tests：download temp-then-rename，以及 remote path containment inside sync root。

## 不在範圍內

- `wspc drive init`
- `wspc drive watch`
- library creation commands
- ignore rules
- operation queue
- automatic text merge
- binary conflict copies
- rename detection
- empty directory preservation

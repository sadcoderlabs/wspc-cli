# Drive 衝突與合併策略設計

## 目標

在 `@wspc/cli` 的 Drive desktop sync 上加入第一版安全的衝突處理 UX。當 local 與 remote 同時修改同一路徑時，CLI 對可安全分類的小型 UTF-8 文字檔嘗試 clean 3-way merge；無法安全合併時，不覆寫 canonical local file，而是保留雙方資料並建立 collision-safe conflict copy 或 conflict record。

這份 spec 以 live todo `tod_01KVJZTFA17VRD7N4N6VKR8KEM` 與 `2026-06-21-drive-conflict-merge-policy-cli-handoff.md` 為來源。它是 M4 conflict UX 規格，不是新的 Drive sync v1 規格。

## 目前 Main 現況

截至本文件寫作時，最新 `origin/main` 已包含 `feat(drive): add desktop sync v1 (#31)` 與 `feat(drive): add sync watch command (#35)`。`wspc drive bind`、`wspc drive sync once`、`wspc drive watch`、`.wspc-drive/state.json`、Drive handwritten command 與對應測試都已落地。M4 應直接在這個 sync v1 基礎上擴充，不需要重新設計 binding、manifest full scan、whole-file upload/download/delete 或 watcher 排程。

現有 Drive sync v1 行為是前置基礎：`wspc drive bind` 綁定既有 library，`wspc drive sync once` 做 full scan、manifest diff、conditional upload/download/delete，並在 `local_and_remote_changed`、`VERSION_CONFLICT`、delete/edit 等情境先記錄 unresolved conflict。`wspc drive watch` 是 `runDriveSyncOnce(root)` 的排程層，啟動時先跑一次 sync，之後用 chokidar 事件 debounce 後再跑同一個 sync engine。M4 只擴充這個保守停車場，不改成 server-side merge，也不在 watch 裡另寫 conflict policy。

## 命令介面 CLI

M4 不新增 top-level command，也不新增 interactive prompt。它擴充既有行為：

```bash
wspc drive sync once [path]
wspc drive watch [path]
```

`drive watch` 已存在，並且會呼叫同一個 `runDriveSyncOnce(root)`。因此 M4 的正確修改邊界是 sync decision / path processing / state / Drive API helper；watch 只需要自然取得更新後的 summary 與 conflict keepalive 行為。

當 sync decision 遇到 conflict：

- 可 merge 文字檔：下載 base 與 remote，讀取 local，做 clean 3-way merge。
- clean merge 成功：用 merged result 更新 canonical local file，再用 remote current `entry_version` 上傳。
- merge hunk conflict、非可安全文字檔、missing base、delete/edit、create/create 不同內容、或 merged upload 再次 `VERSION_CONFLICT`：保留 canonical local 狀態，建立 conflict copy 或 conflict record。

`drive sync once` 在 clean merge 並成功 upload 時仍可 exit code `0`。只要有 unresolved conflict、conflict copy、部分 path 失敗，或 merged upload 再次 conflict，exit code 必須非 `0`。

## 狀態 State 形狀

沿用 `.wspc-drive/state.json` 的 `schema_version: 1`，不用為第一版新增 operation log。`entries[path]` 繼續代表最後一次安全 base。現有 `DriveConflict` 只有 `reason`、`remote_entry_version`、`remote_version_id`，M4 必須相容既有 state：`reason` 保持 required，新增欄位都用 optional。`conflicts[path]` 擴充為能支援 UX 與後續 retry 的 detail：

```json
{
  "conflicts": {
    "notes/today.md": {
      "detected_at": "2026-06-21T10:10:00.000Z",
      "reason": "local_and_remote_changed",
      "type": "edit_edit",
      "strategy": "conflict_copy",
      "base_version_id": "fvr_base",
      "remote_version_id": "fvr_remote",
      "remote_entry_version": 9,
      "conflict_paths": ["notes/today.remote-conflict-20260621T101000Z.fvr_remote.md"]
    }
  }
}
```

`state.ts` 的 schema guard 需要接受這些 optional fields，也要繼續讀得懂已存在的簡單 conflict records。`conflicts[path]` 是狀態與 UX 記錄，不是 durable queue。下一輪 sync 仍從 local scan、state、remote manifest 推導行為。

## 可合併文字檔政策

CLI 不可以只看副檔名。自動 merge 必須採保守 allow policy，三份內容 base、local、remote 都通過才算可 merge：

- size 都不超過 `1 MiB`。
- 都能 strict UTF-8 decode。
- 前 `8 KiB` 沒有 NUL byte，且控制字元比例低於保守門檻；換行與 tab 不算 binary。
- 副檔名或 MIME hint 屬於文字類型。副檔名只是 hint，不能覆蓋 binary sniff。

第一版 extension allowlist：

```text
.txt .md .markdown .json .yaml .yml .csv .tsv .html .htm .css .js .jsx .ts .tsx .xml .svg
```

若 extension 不在 allowlist，但 MIME hint 是 `text/*` 且 sniff 通過，可以視為 mergeable text。若 MIME 或 extension 說是文字但 sniff 或 UTF-8 decode 失敗，必須走 conflict copy。

第一版不支援 UTF-16、Big5、Shift-JIS 或其他 encoding 自動 merge。這些檔案走 conflict copy。

## 3-Way Merge

資料來源：

| 角色 | 來源 |
| --- | --- |
| Base | state 中最後成功同步的 `current_version_id`，透過 versioned download 取得 |
| Local | 目前 canonical local file |
| Remote | manifest 或 `VERSION_CONFLICT.details.remote_entry.current_version_id` |

目前 `createDriveApi().downloadFile(id, path)` 只下載 path 的 latest content，但 OpenAPI snapshot 已讓 `/drive/libraries/{id}/files/content` 支援 `version_id` query。M4 應用最小改動擴充現有 raw byte helper，例如 `downloadFile(id, path, versionId?)`，用同一條 content endpoint 下載 base 或 remote version。

流程：

1. 確認 state 有 base `current_version_id`。沒有 base 時不 merge。
2. 下載 base 與 remote bytes。
3. 對 base、local、remote 做 mergeable text classification。
4. 用 `node-diff3` 做 line-based 3-way merge。
5. Clean merge 成功時，用 local 檔案目前的 newline style 輸出 merged text；無法判斷時使用 `\n`。
6. 寫回 canonical local file 前，重新 hash local file，確認它仍等於 merge input 的 local hash。
7. 用 temp file + rename 寫回 canonical local file。
8. 用 remote current `entry_version` 上傳 merged result。
9. Upload 成功後，用 server response 更新 `entries[path]`，並清除該 path 的 conflict record。

如果 `node-diff3` 回傳 conflict hunk，M4 不把 conflict markers 寫進 canonical local file，改走 conflict copy。這避免使用者誤以為檔案已可用。

## 衝突副本 Conflict Copy

Conflict copy 必須 collision-safe，不能覆蓋既有檔案。命名格式：

```text
<basename>.<side>-conflict-<UTC timestamp>-<short version id><extension>
```

範例：

```text
notes/today.remote-conflict-20260621T101000Z.fvrabcd.md
notes/today.local-conflict-20260621T101000Z.local.md
```

寫檔規則：

- 使用 exclusive create；若檔案已存在，加 `-2`、`-3` 後綴重試。
- 所有 conflict copy 都必須落在 sync root 內，並重用 Drive path validation 與 containment helper。
- 寫入時使用 temp file + rename。
- 同一輪 `sync once` 產生的 conflict copy 不再被同輪上傳。現有 engine 先掃 local files 再處理 union paths，因此這點可由既有流程自然成立；watch 若收到 conflict copy 的 filesystem event，會在後續新一輪 full scan 才處理它。

Edit/edit 無法 clean merge 時，保留 canonical local file 不動，下載 remote version 為 remote conflict copy。Base 不預設寫出；需要 debug 時從 server version history 取。

Create/create 且內容不同時，保留 canonical local file，下載 remote 為 remote conflict copy。

## 刪除與編輯 Delete/Edit

Delete/edit 不做自動選邊：

| 情境 | 行為 |
| --- | --- |
| local deleted，remote edited | 保持 canonical path 刪除狀態，下載 remote 為 remote conflict copy，記錄 conflict |
| local edited，remote deleted | 保留 canonical local file，記錄 remote deleted conflict，不自動重新上傳 |
| local deleted，remote unchanged | 照 Drive sync v1 規則 delete remote |
| local unchanged，remote deleted | 照 Drive sync v1 規則移除 local file 並更新 state |

Local edited vs remote deleted 不建立空白 conflict copy，因為 remote side 是 tombstone，沒有內容可保留。CLI summary 必須明確告知 remote 已刪除、local edit 被保留。

## 重新命名 Rename 政策

M4 仍不做 rename detection。Rename 以 delete + create 進入 decision table。若 rename 與 remote edit/delete 發生衝突，使用 delete/edit 或 create/create 規則處理。

不要加入 inode tracking、content similarity 或 rename heuristic。這些留到 sync engine 有實際需求後再做。

## 輸出與 JSON

Human summary 至少包含 merged count、conflict count、conflict copy path、failed count。現有 summary 已包含 uploaded、downloaded、deleted、unchanged、conflicts、errors 與 per-path action，M4 可以只新增 `merged` 與 per-path conflict copy metadata。

JSON output 沿用 global `--json`，不新增 Drive 專屬 JSON flag。Structured summary 需要讓 automation 能判斷哪些 paths 已 clean merged、哪些 paths 需要人工處理、哪些 paths 失敗。`drive watch` 目前輸出 newline-delimited events；它應沿用更新後的 `drive_sync_once` summary，不新增另一套 event schema。

## 安全與隱私

`.wspc-drive/state.json` 不得保存 access token、refresh token 或 API key。

Logs 不得輸出檔案內容、merged text、diff hunk、raw body、auth headers 或完整 server error body。Debug mode 也只輸出 path、version id、hash、size、strategy、error code 等 metadata。

Remote path 寫入 conflict copy 前必須通過 path validation，避免寫出 sync root。Clean merge 寫回 canonical local file 前必須重新確認 local hash；若使用者在 merge 過程中改檔，放棄寫回並記錄 conflict。

Clean merge upload 後如果又遇到 `VERSION_CONFLICT`，M4 不做多輪 automatic rebase。這避免 sync loop 在高競爭 path 上反覆改寫；需要更好的多人協作時，應重新評估 CRDT 或 app-managed document model，而不是把任意檔案同步硬做成即時協作。

## 測試

遵守 TDD。最小測試集合：

- File classification tests：UTF-8 text、binary NUL、invalid UTF-8、大於 `1 MiB`、extension allowlist、MIME `text/*` hint、extension 是文字但 sniff 失敗。
- Clean merge tests：base/local/remote 可自動合併、newline style 保留、merged result 用 remote entry version upload、state 更新、conflict record 清除。
- Merge conflict tests：`node-diff3` conflict hunk 不寫 canonical file，remote conflict copy exclusive create，重名時加後綴。
- Missing base tests：base version id 缺失或 versioned download 404 時走 conflict copy。
- Delete/edit tests：local delete vs remote edit、local edit vs remote delete、unchanged delete/download happy path。
- Race tests：merge 過程 local file hash 改變時不覆寫、merged upload 收到 `VERSION_CONFLICT` 時不循環重試。
- Watch tests：現有 watch tests 已覆蓋 conflict summary keepalive；M4 只需要確認 watch 沿用更新後的 `runDriveSyncOnce` summary，且 conflict copy 不在同一輪 `sync once` 被再次處理。

## 不在範圍內

- Server-side merge。
- 新增 interactive prompt。
- 新增 Drive 專屬 JSON flag。
- UTF-16、Big5、Shift-JIS 或其他 encoding merge。
- Rename detection。
- Multi-round automatic rebase。
- CRDT 或 app-managed document model。
- Ignore pattern 或 conflict workspace；等 conflict copy 噪音成為實際問題再做。

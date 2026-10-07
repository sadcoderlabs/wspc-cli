# Product Review Brief：`wspc drive search` 支援 Workspace scope 與 `--path-prefix`

來源 Todo：`tod_01M4A48GD4EMGXY7R3MAD1X7KE`。Backend 權威 spec：[Drive search findability](https://github.com/sadcoderlabs/wspc/blob/main/docs/superpowers/specs/2026-10-07-drive-search-findability-design.md)（wspc#1302，2026-10-07 已部署 production）。

## Goal and Problem

**受影響的使用者**：用 `wspc drive search` 找 Drive 檔案的 CLI 使用者，以及透過 CLI 操作 Drive 的 agent。

**未被滿足的需求**：backend 已經可以一次搜尋整個 Workspace、用 `path_prefix` 限定資料夾，但 published `@wspc/cli` 0.14.0 的 `drive search` 仍是舊介面：

- `<id>` 是必要 positional，無法省略 library 搜整個 Workspace。
- 沒有 `--path-prefix`。
- `--cursor` 說明仍寫「same query and library」，沒有提到 `path_prefix` 與 v1 cursor 失效。

結果是使用者只能逐 library 搜，要跨 library 或限定資料夾就得自己打 HTTP；wspc 的 landing 文件也只能寫「待外部 wspc-cli 發佈」並附 HTTP example。

**證據（2026-10-07 本機查證）**：

| 事實 | 來源 |
| --- | --- |
| Live `https://api.wspc.ai/openapi.json` 新增 `GET /drive/search`（operationId `drive_workspace_search`），兩個 search endpoint 都有 `path_prefix`，response 每筆帶 `library_id`。 | live OpenAPI readback |
| 與 committed `spec/openapi.json` 的差異只有這兩個 path 與 `DriveSearchResponse` schema，沒有其他 drift。 | 兩份 spec 的 path／schema 比對 |
| 兩個 endpoint 的 `x-cli.command` 都是 `drive search`，差別只在 per-library 那個有 `positional: ["id"]`。 | live OpenAPI `x-cli` |
| codegen 以 command path 決定輸出檔名，兩個 op 都寫到 `src/generated/cli/drive/search.ts`，後者覆蓋前者；`index.ts` 仍 import 兩個名字。 | `tools/cli-codegen/main.ts:230-245`，在 scratchpad 對 live spec 乾跑 |
| 對 live spec 跑 `sync-spec → generate → typecheck` 會失敗：`index.ts(39,10): error TS2305: Module '"./drive/search.js"' has no exported member 'driveSearchCommand'`。 | 同上乾跑 |
| `Release` workflow 每次都先 `sync-spec` 再 `generate` 再 `typecheck`，所以在修好之前任何一次 release 都會中止。 | `.github/workflows/release.yml:40-52` |

**最小有用的 milestone**：讓 codegen 能處理這對同名 command，讓 `wspc drive search` 支援省略 library 與 `--path-prefix`，同步 live spec，恢復 release 可用。

**限制**：

- 既有 `wspc drive search <id> --query ...` 用法不能壞（script 相容）。
- `src/generated/` 不手改；要改 generator 或 handwritten layer。
- `x-cli` metadata 由 wspc backend repo 決定，本 repo 只能消費。
- `path_prefix` 語意固定：純字串前綴、不解讀萬用字元、空字串視同未提供，與 `drive manifest get --path-prefix` 相同。
- 每個查詢詞至少 3 個字元，短詞回空結果而非錯誤；舊 cursor 回 `VALIDATION_ERROR`。這些是 server 行為，CLI 只需正確轉述。

## User Stories

- 身為 CLI 使用者，我想要 `wspc drive search --query 日本旅遊` 不帶 library 就能搜整個 Workspace，以便不用先 `drive library ls` 再逐一搜。
- 身為 agent，我想要 `wspc drive search <id> --query 日本旅遊 --path-prefix travel/` 只回 `travel/` 底下的檔案，以便縮小候選再 `drive file` 讀取。
- 身為 CLI 使用者，我想要 `--cursor` 續頁在 Workspace scope 加 `--path-prefix` 下照常運作，並且在 `--help` 看到正確的 cursor 規則。
- 身為既有 script 的作者，我想要 `wspc drive search <id> --query ...` 升級後行為不變。
- 身為 maintainer，我想要 release workflow 在 live spec 同步後仍能通過 typecheck，以便之後的 release 不再被這對 endpoint 卡住。

## Experience

CLI 介面，無 GUI。預期的 help：

```
Usage: wspc drive search [options] [id]

Search drive text across the Workspace

Arguments:
  id                     library ID; omit to search every library in the Workspace

Options:
  --query <value>        query
  --limit <value>        limit
  --cursor <value>       Opaque Search Cursor from next_cursor; reuse with the same query, library and path_prefix. No TTL.
  --path-prefix <value>  path_prefix
  -h, --help             display help for command
```

| 狀態 | 行為 |
| --- | --- |
| Happy（Workspace） | `wspc drive search --query 日本旅遊` 呼叫 `GET /drive/search`，list 顯示 `library_id`、`path`、`snippet` 三欄；`--json` 原樣輸出 `{ results, next_cursor? }`。 |
| Happy（per-library） | `wspc drive search lib_x --query 日本旅遊 --path-prefix travel/` 呼叫 `GET /drive/libraries/lib_x/search?...&path_prefix=travel/`，顯示欄位依該 endpoint 的 `x-cli.display`（`path`、`snippet`）。 |
| 續頁 | 有 `next_cursor` 時沿用既有 pagination footer；使用者以 `--cursor` 搭配相同 query／scope／prefix 續頁。 |
| Empty | 無命中（含詞少於 3 字元）顯示 `no matches`，exit 0。 |
| Failure：舊或不符的 cursor | server 回 400 `VALIDATION_ERROR`，CLI 以既有格式印 `HTTP 400: {...}`，exit 1；help 已說明要重新搜尋。 |
| Failure：library 不存在／已刪除／他人 Workspace | server 回 404 `NOT_FOUND`，CLI 印 `HTTP 404: {...}`，exit 1。 |
| Failure：缺 `--query` | 與現在相同，由 server 回 400；CLI 不另做前置檢查。 |
| Permission | 沿用既有 bearer auth 與 `--account`；`x-cb-drive` consistency bookmark 由現有 fetch wrapper 依 response header 處理，不需新邏輯。 |
| Accessibility | 純文字輸出，沿用既有 pretty／JSON 切換。 |

## Product Acceptance Criteria

1. `wspc drive search --query <詞>` 不帶 library 可以執行，回傳跨 library 的結果，pretty 輸出有 `library_id` 欄。
2. `wspc drive search <id> --query <詞>` 維持 0.14.0 的行為與輸出欄位。
3. 兩種 scope 都接受 `--path-prefix <prefix>`，並原樣送到 server 的 `path_prefix`。
4. `wspc drive search --help` 顯示 `[id]` 為可省略、`--path-prefix` 存在，且 `--cursor` 的說明提到 `path_prefix`。
5. `--cursor` 在 Workspace scope 搭配 `--path-prefix` 可續頁；舊 cursor 得到 server 的 `VALIDATION_ERROR` 而非 CLI 自行報錯。
6. `spec/openapi.json` 與 `src/generated/` 更新到 live production spec，且 `typecheck`、`test`、`build` 通過。
7. 之後對 live spec 跑 `sync-spec → generate` 不再產生 drift 或 typecheck 失敗。

## 已定案的決策（2026-10-07 核准）

- CLI 以 `wspc drive search [id]` 表達 scope：positional `id` 改為 optional，省略即 Workspace scope，有給即 per-library。既有 `drive search <id>` 用法不變。
- codegen 新增「成對 command」規則：同一個 `x-cli.command` 對應兩個 operation，且恰好一個有 positional path param、另一個沒有時，合成一個 command；其他形式的重名直接讓 codegen 報錯中止。help、flag、description 仍由 spec 驅動。
- wspc landing 文件 `cli.md` 的 search 段落在 CLI release 後，於 wspc repo 另開 Todo 更新；本 milestone 不跨 repo 開 PR。

## Out of Scope

- 不替 `--query` 做 3 字元前置檢查，也不做 cursor 格式檢查：皆為 server contract，CLI 只轉述。
- 不改 `drive manifest get`、`drive file` 等其他 Drive command。
- 不處理 `x-cli` metadata 本身（屬 wspc backend repo）。
- 不在本 milestone 觸發 npm release；release 仍由使用者手動在 Actions 執行。
- 不加 `--library <id>` 別名；若之後使用者反映 positional 不直覺再評估。

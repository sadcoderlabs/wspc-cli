# `wspc drive search` 支援 Workspace scope 與 `--path-prefix`

產品決策依據：[Product Review Brief](2026-10-07-drive-search-workspace-scope-brief.md)（2026-10-07 核准）。Backend 權威 spec：[Drive search findability](https://github.com/sadcoderlabs/wspc/blob/main/docs/superpowers/specs/2026-10-07-drive-search-findability-design.md)。來源 Todo：`tod_01M4A48GD4EMGXY7R3MAD1X7KE`。

## Problem Statement

身為用 `wspc drive search` 找 Drive 檔案的使用者或 agent，我想要省略 library 就搜整個 Workspace、用 `--path-prefix` 限定資料夾，以便不必先列 library、逐一搜尋，或自己打 HTTP。

2026-10-07 的現況：

- wspc backend 已部署 `GET /drive/search`（operationId `drive_workspace_search`），兩個 search endpoint 都接受 `path_prefix`，每筆結果帶 `library_id`，Search Cursor 升 v2。
- published `@wspc/cli` 0.14.0 的 `drive search` 仍要求 `<id>`、沒有 `--path-prefix`、`--cursor` 說明過時。
- live OpenAPI 中兩個 endpoint 的 `x-cli.command` 都是 `drive search`，只差 per-library 那個有 `positional: ["id"]`。codegen 以 command path 當輸出檔名，兩個 op 都寫到 `src/generated/cli/drive/search.ts`，後者蓋掉前者，`index.ts` 仍 import 兩個名字。對 live spec 跑 `sync-spec → generate → typecheck` 會得到 `index.ts(39,10): error TS2305: Module '"./drive/search.js"' has no exported member 'driveSearchCommand'`。
- `Release` workflow 每次都先 `sync-spec` 再 `generate` 再 `typecheck`，所以修好前任何一次 release 都會中止。

限制：既有 `wspc drive search <id> --query ...` 不能壞；`src/generated/` 不手改；`x-cli` metadata 由 backend repo 決定；`path_prefix`、3 字元規則、cursor 失效都是 server 行為，CLI 只轉述。

## Solution

### 使用者介面

`wspc drive search [id] --query <value> [--limit <value>] [--cursor <value>] [--path-prefix <value>]`

| 情境 | 行為 |
| --- | --- |
| 省略 `[id]` | 呼叫 `GET /drive/search`（SDK `driveWorkspaceSearch`），render kind `drive_workspace_search`，display 依該 op 的 `x-cli.display`（欄位 `library_id`、`path`、`snippet`）。 |
| 給 `[id]` | 呼叫 `GET /drive/libraries/{id}/search`（SDK `driveSearch`），render kind `drive_search`，display 依該 op 的 `x-cli.display`（欄位 `path`、`snippet`），與 0.14.0 相同。 |
| `--path-prefix` | 兩種 scope 都原樣放進 query `path_prefix`；未給就不送。 |
| `--query`、`--limit`、`--cursor` | 原樣送出；缺 `--query` 由 server 回 400，CLI 不做前置檢查。 |
| 無命中 | 顯示 `no matches`，exit 0。 |
| server 4xx | 沿用 `runSdkCommand` 的 `HTTP <status>: {...}` 輸出，exit 1。 |
| `--help` | summary 與 description 取自沒有 positional 的 op（`drive_workspace_search`）；argument 說明由 codegen 以 `<name>; omit to <fallback summary 首字小寫>` 產生（本案為 `id; omit to search drive text across the Workspace`），避免在通用 codegen 寫死 drive 專屬文字；flag 說明來自 spec 的 parameter description。 |
| `x-cb-drive` bookmark | 由既有 consistency fetch wrapper 依 response header 處理，不需新邏輯。 |

### codegen 成對 command 規則

- 定義：兩個 operation 的 `x-cli.command` 相同，且恰好一個有 positional path param（`x-cli.positional` 或 path param 自動補上的）、另一個完全沒有 path param，稱為一組 Paired Command。
- Paired Command 只產生一個檔案（命名與現在相同，`drive/search.ts`），export 名稱取有 positional 的 op（`driveSearchCommand`），檔頭註解列出兩個 operationId。
- positional 以 `[name]` 宣告為 optional。action 內 `name === undefined` 時呼叫無 positional 的 op，否則呼叫有 positional 的 op；兩條分支各自帶自己的 `kind` 與 `display`。
- query／body flag 以兩個 op 的 query／body field 聯集產生；本案兩者 query 相同。
- 不符合 Paired Command 定義的重名（例如三個 op 同名、兩個都有或都沒有 positional），codegen 以明確錯誤中止，不得 silent overwrite。
- `index.ts` 對 Paired Command 只 import、註冊一個 command。

### Spec 同步

`spec/openapi.json`、`src/generated/sdk/`、`src/generated/cli/` 以 `npm run sync-spec && npm run generate` 更新到 live production spec，regenerated diff 一併提交。

## Acceptance Criteria

所有自動化測試在本機與 CI 以 `npm test` 執行，mock generated SDK 與 auth loader，不需真實帳號。

| 編號 | 情境與預期結果 | 時機、環境與佐證 |
| --- | --- | --- |
| AC1 | `driveSearchCommand.parseAsync(["node","search","--query","日本旅遊"])` 呼叫 mocked `driveWorkspaceSearch` 一次、`driveSearch` 零次；input 無 `path`，`query.query === "日本旅遊"`；render context `kind === "drive_workspace_search"` 且 `display.columns` 含 `library_id`。 | pre-merge automated，`test/generated/drive.test.ts`。 |
| AC2 | 同 command 帶 `lib_123 --query 日本旅遊 --path-prefix travel/`：呼叫 `driveSearch` 一次、`driveWorkspaceSearch` 零次；`path.id === "lib_123"`，`query.path_prefix === "travel/"`；render kind `drive_search`，columns 為 `["path","snippet"]`。 | pre-merge automated，同上。 |
| AC3 | 省略 id 並帶 `--path-prefix travel/ --cursor c2`：`driveWorkspaceSearch` 收到 `query.path_prefix === "travel/"` 與 `query.cursor === "c2"`。未給 `--path-prefix` 時 `query.path_prefix === undefined`。 | pre-merge automated，同上。 |
| AC4 | `emitCommand` 對一組 Paired Command 輸入：輸出含 `.argument("[id]"`、`--path-prefix <value>`、兩個 `operation:`（`driveSearch`、`driveWorkspaceSearch`）、`kind: "drive_search"` 與 `kind: "drive_workspace_search"`、`id === undefined` 分支；對非 Paired 的重名輸入，codegen 主流程丟出含兩個 operationId 的錯誤。 | pre-merge automated，`tools/cli-codegen/emit.test.ts`、`tools/cli-codegen/main.test.ts`。 |
| AC5 | `node dist/cli.js drive search --help` 輸出含 `[id]`、`--path-prefix <value>`、`--cursor` 說明含 `path_prefix` 字樣。 | pre-merge automated（`test/cli-root.test.ts` 或新 smoke test 以 `buildProgram` 取 help text）或 PR 描述貼 `npm run build` 後的輸出。 |
| AC6 | `spec/openapi.json` 含 `/drive/search`；`src/generated/cli/index.ts` 對 `drive search` 只有一個 import；`npm run typecheck`、`npm test`、`npm run build` 通過。 | pre-merge，CI `pr.yml`。 |
| AC7 | 在乾淨 checkout 執行 `npm run sync-spec && npm run generate && git status --porcelain spec src/generated` 輸出為空（live spec 未再變動時），且 `npm run typecheck` 通過。 | pre-merge manual，PR 描述貼 readback；若 live spec 在實作期間又變動，貼出 diff 的 path 清單並說明。 |
| AC8 | Live 驗收：以已登入帳號執行 `node dist/cli.js drive search --query <本人 Workspace 中存在的 3 字元以上詞>`，回傳含 `library_id` 的結果；`node dist/cli.js drive search <id> --query <同一詞> --path-prefix <存在的資料夾/>` 只回該前綴下的 path；以第一頁 `next_cursor` 加 `--cursor` 續頁成功；以任意舊字串當 `--cursor` 得到 `HTTP 400` 且 body 含 `VALIDATION_ERROR`。 | pre-merge manual，PR 描述貼 transcript（去除 token 與個人內容，只留欄位與 status）。 |
| AC9 | Release 後 `npx -y -p @wspc/cli@latest wspc drive search --help` 顯示 `[id]` 與 `--path-prefix`。 | post-release manual；release 由使用者手動觸發，不是 merge gate。 |

## Implementation Decisions

### 取捨順序與決策權

優先序：既有 `drive search <id>` 相容 > generated output 由 spec 驅動 > codegen 規則通用性 > 程式碼量。

| 限制 | 一行理由 |
| --- | --- |
| 不手寫 `drive search` command、不加本地 operationId skip 清單 | help 與 flag 文字會與 spec 脫鉤，之後 backend 改 description 不會跟上。 |
| 非 Paired 的重名必須報錯 | 今天的 silent overwrite 就是沒有這個 guard 造成的。 |
| per-library 分支維持 `kind: "drive_search"` 與原 display | 0.14.0 行為不變，既有 renderer／script 不受影響。 |
| CLI 不做 3 字元或 cursor 前置檢查 | server contract 已定義，重複實作只會製造不一致。 |

判斷詞定義：

- 「Paired Command」：同名兩個 op，恰好一個有 path param、另一個沒有。例：`drive_search`（`/drive/libraries/{id}/search`）與 `drive_workspace_search`（`/drive/search`）。反例：兩個 op 都有 path param 但 param 名不同；三個 op 同名。
- 「相容」：`wspc drive search lib_x --query q` 在 0.14.0 與本版送出相同 HTTP request（除新增的 optional `path_prefix` 未給時不送），render kind 與 columns 相同。

實作者自行決定：

- Paired Command 在 `main.ts` 的分組方式（先收集再成對，或在迴圈內查表）。
- `emitCommand` 的輸入形狀（例如 `fallback?: { operationId, display?, queryFields }`）與分支程式碼排版。
- 檔頭註解格式、測試檔拆分與 fixture 命名。

決定後回報：

- 若兩個 op 的 query field 聯集需要去重或衝突處理（本案不需要），說明採用的規則。
- AC5 採自動化或 PR 描述貼輸出。

停下來問：

- live spec 在實作期間出現 search 以外的 drift，且 regenerate 後 typecheck 或既有測試失敗。
- 需要改 `x-cli` 語意、`runSdkCommand` 介面、或 `src/handwritten/output` 的 renderer 分派。
- 發現 live spec 再出現第二組同名 command 但不符合 Paired 定義。

### 實作地圖

要改的檔案：

| 檔案 | 改動 |
| --- | --- |
| `tools/cli-codegen/main.ts` | 收集所有符合條件的 op 後，依 `x-cli.command` 分組；對 Paired Command 以有 positional 的 op 為主、另一個為 fallback 呼叫 `emitCommand` 一次；其他重名 throw。`emitted` 對 Paired 只 push 一筆。 |
| `tools/cli-codegen/emit.ts` | `EmitInput` 新增 fallback 欄位；positional 有 fallback 時以 `[name]` 宣告；action 內依 `name === undefined` 分支呼叫兩個 operation；import 兩個 SDK 函式；summary／description／help 取 fallback op。 |
| `tools/cli-codegen/emit.test.ts`、`tools/cli-codegen/main.test.ts` | AC4。 |
| `test/generated/drive.test.ts` | AC1–AC3，沿用現有 `vi.mock` SDK 與 `loadCommands()` 模式，mock 加入 `driveSearch`、`driveWorkspaceSearch`。 |
| `spec/openapi.json`、`src/generated/sdk/*`、`src/generated/cli/drive/search.ts`、`src/generated/cli/index.ts` | `npm run sync-spec && npm run generate` 產物，不手改。 |
| `README.md` | Commands 表加一列 `wspc drive search [id] --query <value> [--path-prefix <prefix>]`；Roadmap 已連結本 spec。 |
| `CONTEXT.md` | 已加入 `Search Scope` 詞條。 |

不要碰：`src/handwritten/commands/drive/*`（search 不走 handwritten）、`src/handwritten/output/render.ts`、`src/handwritten/auth/consistency-fetch.ts`、`scripts/sync-spec.ts`、`.github/workflows/*`。

要擴充的既有測試與 fixture：`test/generated/drive.test.ts` 的 mock 與 `loadCommands()`；`tools/cli-codegen/emit.test.ts` 既有 `emitCommand` 輸入樣式（見 `invite accept`、`todo show` 案例）。

允許的附帶改動：regenerate 後 `src/generated/sdk/types.gen.ts` 內與 search 無關但由同一份 live spec 帶出的型別差異（AC7 讀回時列出）；`src/version.ts` 由 `sync-spec` 重建但維持不 commit。

### 已查證事實與已知陷阱

| 事實 | 來源 |
| --- | --- |
| live spec 與 committed spec 的差異只有 `/drive/search`（新增）、`/drive/libraries/{id}/search`（改動）與 `DriveSearchResponse` schema。 | 2026-10-07 兩份 spec path／schema 集合比對。 |
| 兩個 op 的 `x-cli`：`drive_workspace_search` 無 positional，`display.columns = ["library_id","path","snippet"]`；`drive_search` `positional: ["id"]`，`display.columns = ["path","snippet"]`。 | live OpenAPI `x-cli`。 |
| 兩個 op 的 query 參數相同：`query`（required）、`limit`、`cursor`、`path_prefix`。 | live OpenAPI parameters。 |
| codegen 輸出檔名為 `x-cli.command` 的 path，同名會覆蓋；`buildTree` 的 leafVarName 以最後一個為準。 | `tools/cli-codegen/main.ts:230-245`、`:142-156`。 |
| 對 live spec 乾跑 `generate → typecheck` 的失敗訊息：`src/generated/cli/index.ts(39,10): error TS2305: Module '"./drive/search.js"' has no exported member 'driveSearchCommand'`。 | 2026-10-07 scratchpad 乾跑。 |
| `Release` workflow 依序 `sync-spec`、`generate`、`typecheck`、`build`、`test`，再 commit drift 與 bump。 | `.github/workflows/release.yml:40-70`。 |
| `pr.yml` 跑 `typecheck`、`test`、`build`，不跑 `sync-spec`。 | `.github/workflows/pr.yml`。 |
| `x-cb-drive` bookmark 由 `consistency-fetch.ts` 依 response header 名稱處理，與 path 無關。 | `src/handwritten/auth/consistency-fetch.ts:5-12`。 |
| commander 的 optional argument `[id]` 在省略時 action 收到 `undefined`。 | commander 既有行為；`drive bind [path]` 已使用。 |
| `drive manifest get --path-prefix` 由 codegen 自動從 `path_prefix` query 產生 kebab flag，不需 `x-cli.options`。 | `src/generated/cli/drive/manifest/get.ts:15`。 |

已知陷阱：

| 症狀 | 處理 |
| --- | --- |
| 先 `sync-spec` 再改 generator 會讓 repo 在中途處於 typecheck 失敗狀態。 | 先改 generator 與測試（用 fixture 模擬 pair），再 `sync-spec && generate`，同一個 PR 內提交。 |
| `test/generated/drive.test.ts` 的 `vi.mock` 列舉 SDK 函式；缺 `driveWorkspaceSearch` 時 import 會得到 undefined 而非錯誤。 | mock 兩個 search 函式，並斷言未被呼叫的那個 call count 為 0。 |
| `src/version.ts` 被 `sync-spec` 改寫。 | 已 gitignore，不加入 commit。 |
| live spec 在實作期間再變動。 | AC7 讀回時列出 path 差異；只有 search 以外的差異造成失敗才停下來問。 |

實作前 live readback：

1. `curl -s https://api.wspc.ai/openapi.json | python3 -c 'import json,sys;s=json.load(sys.stdin);print(sorted(s["paths"]["/drive/search"]["get"]["x-cli"]), s["paths"]["/drive/libraries/{id}/search"]["get"]["x-cli"].get("positional"))'`，預期 `/drive/search` 無 `positional`、per-library 為 `["id"]`。若 upstream 已改成不同 command 名或 positional 形狀，停下來問。

### 後續方向

Paired Command 規則以「恰好一個有 path param」為界；若 backend 之後出現同名三層 scope（例如 org／workspace／library），再擴充為多 fallback。

## Testing Decisions

| 準則 | 驗證方式 |
| --- | --- |
| AC1–AC3 | `test/generated/drive.test.ts`，mock SDK 與 render，斷言 operation 呼叫次數、input、render context。 |
| AC4 | `tools/cli-codegen/emit.test.ts` 字串斷言；`main.test.ts` 對分組／報錯函式的單元測試（需把分組邏輯抽成可 import 的純函式）。 |
| AC5 | 以 `buildProgram()` 或 `dist/cli.js` 取 help 文字斷言；若實作者改採 PR 描述貼輸出，說明原因。 |
| AC6 | CI `pr.yml`。 |
| AC7 | 手動 readback，PR 描述。無法自動化：PR CI 不跑 `sync-spec`，避免 CI 依賴 live API。 |
| AC8 | 手動 live transcript，PR 描述。無法自動化：需真實帳號與資料。 |
| AC9 | post-release 手動；release 為手動 workflow。 |

實作切片（每片先寫會紅的測試）：

1. **codegen 分組與報錯**：`main.test.ts` 先寫「同名兩個 op 恰一個有 path param → 回傳一組 pair」與「不符合 → throw 含兩個 operationId」（紅：函式不存在）；在 `main.ts` 抽出純函式並接上主流程；done = 兩個測試綠，既有 `main.test.ts` 綠。
2. **emit 合成 command**：`emit.test.ts` 先寫 AC4 的字串斷言（紅：無 `[id]`、無第二個 operation）；改 `emit.ts`；done = AC4 綠，既有 `emit.test.ts` 與 `test/cli-codegen.test.ts` 綠。
3. **spec 同步與 regenerate**：`npm run sync-spec && npm run generate`；done = `src/generated/cli/drive/search.ts` 為合成版本、`index.ts` 單一 import、`npm run typecheck` 綠。
4. **generated command 行為**：`test/generated/drive.test.ts` 先寫 AC1–AC3（紅：在切片 3 前 import 失敗或無 `--path-prefix`）；done = AC1–AC3 綠。
5. **help 與文件**：AC5 測試或輸出；README Commands 表；done = AC5、AC6 綠。
6. **手動驗收與 PR**：AC7 readback 與 AC8 transcript 寫入 PR 描述；merge 後 AC9 由使用者 release 後確認。

## Out of Scope

- `--library <id>` flag 別名：若使用者反映 optional positional 不直覺再加。
- CLI 端 3 字元檢查與 cursor 格式檢查：server contract 已覆蓋。
- wspc landing `cli.md` 的 search 段落：CLI release 後在 wspc repo 另開 Todo。
- 觸發 npm release：由使用者手動執行 `Release` workflow。
- 處理 search 以外的 live spec drift：目前沒有；若出現，另開 Todo。

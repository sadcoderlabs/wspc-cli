# Drive sync exclude rules

## 問題

`wspc drive sync once` 與 `wspc drive watch` 目前會同步 bound folder 中除 `.wspc-drive/`、symlink、non-regular file 與 internal temp artifact 以外的所有檔案。使用者無法把 machine-local build output、dependency directory 或其他不應進入 Drive library 的 path 移出 sync scope。

只在 local scanner 略過 path 並不安全。現有 sync decision 會合併 local、remote 與 state paths；若 remote 或 state 仍包含該 path，單邊過濾可能觸發 download、remote delete 或 conflict。Exclude 必須是 shared sync boundary，而不是 scanner optimization。

## 解法

每個 bound folder 可選擇建立 `.wspc-drive/ignore`。每一條有效規則指定一個 normalized、sync-root-relative Drive path：

```text
# Machine-local files
.DS_Store
node_modules/
build/output.log
```

- 沒有 `ignore` file 等同沒有 exclude rules。
- 空白行與第一個非空白字元為 `#` 的行是註解。
- 每行前後 whitespace 會移除。
- 不以 `/` 結尾的規則只比對該 exact file path。
- 以 `/` 結尾的規則比對該 directory path 與所有 descendants。
- 比對區分大小寫。
- 規則只影響當前 machine，不同步到 Drive library。

符合規則的 path 是 excluded path，完全位於 sync scope 外。`sync once` 與 `watch` 不得 upload、download、delete 或回報其 conflict。加入 exclude 前已存在的 local 與 remote content 均保持不變。

## User Stories

- 使用者可以排除一個 exact file，例如 `.DS_Store`。
- 使用者可以排除一個 directory tree，例如 `node_modules/`。
- 使用者可以對 nested path 建立規則，例如 `build/output.log`。
- 使用者執行 `sync once` 或長時間執行 `watch` 時會得到相同 exclude 行為。
- 使用者修改 `ignore` file 後，正在執行的 `watch` 不需重啟即可套用新規則。
- 使用者寫入無效規則時，sync 會在任何 content mutation 前停止並指出行號。

## Implementation Decisions

### 規則載入與驗證

新增一個 handwritten Drive helper，負責讀取、解析、驗證與比對 `.wspc-drive/ignore`。不要新增 dependency；exact path 與 directory prefix 可由現有 Node.js string operations 完成。

讀取規則後，先移除空白與註解，再以現有 `validateDrivePath()` 驗證 normalized path。Directory rule 應先移除最後的 `/` 再驗證，但 matcher 必須保留其 directory semantics。Duplicate rules 可 deduplicate。

下列規則無效：

- absolute path
- `.` 或 `..` segment
- backslash
- empty segment
- control character
- 超過現有 Drive path byte limits
- 只有 `/` 的 directory rule

不存在的合法 path 仍可保留。無效規則應拋出包含 `.wspc-drive/ignore` 與 1-based line number 的 non-retryable error；整輪 sync 在 local 或 remote content mutation 前停止。不要默默略過錯誤規則。

### 共用 sync boundary

`runDriveSyncOnce()` 每輪都重新讀取 rules，並在建立 action path union 前套用同一個 matcher：

- local full scan 不收集 excluded files，且 directory rule 應 prune traversal。
- incremental rescan 不保留或重新加入 excluded cache entries。
- remote manifest 中的 excluded entries 不進入 action path union。
- state 中 excluded paths 的 `entries`、`conflicts`、`scan_cache` 與 `scan_errors` 會清除。
- rename detection 與 unresolved-conflict summary 不處理 excluded paths。

這個 boundary 必須保證 excluded path 即使只存在於 remote manifest 或舊 state，也不會產生 action。不要只在 chokidar 或 scanner 增加 guard。

清除 metadata 時不修改 local 或 remote content。日後移除 exclude rule，該 path 視為首次進入 sync scope：兩端 hash 相同可建立新 state；只有一端存在可照既有 create/download 流程處理；兩端內容不同則使用既有 create-create conflict 行為。

### Watch 行為

`.wspc-drive/ignore` 是唯一需要觸發 watch sync 的 internal file。Chokidar 仍忽略其他 `.wspc-drive/` events，但 `ignore` file 的 add、change 或 unlink 應排程 full sync，讓新增、修改與刪除規則立即生效。

其他 local event 仍可沿用現有 dirty-path scheduler。Correctness 由 `runDriveSyncOnce()` 的 shared matcher 保證；v1 不需要在 watcher 再維護第二份 matcher，只為減少 excluded path 造成的 no-op sync。

Remote realtime event 繼續觸發 full reconciliation，但 excluded remote paths 會在 shared sync boundary 被過濾。

### Output 與相容性

本功能不修改 Drive API、OpenAPI generated code、state schema version 或既有 sync summary shape。Exclude metadata 不需要寫進 `state.json`；規則的 source of truth 是 `.wspc-drive/ignore`。

缺少 `ignore` file 時，現有使用者行為不變。`.wspc-drive/` 仍永遠排除，且 `ignore` file 本身永不 upload。

## Testing Decisions

實作採 TDD，先加入會失敗的最小測試，再修改 production code。

- Rule helper：涵蓋 missing file、blank/comment、exact file、directory descendants、case-sensitive comparison、deduplicate 與 invalid rule line number。
- Scanner：證明 excluded directory 會 prune traversal，incremental cache 不保留 excluded entries。
- Sync：同一測試同時放入 local、remote 與 state-only excluded paths，證明沒有 upload、download、delete 或 conflict，且四類 state metadata 都被清除。
- Re-include：移除 rule 後，兩端不同內容走既有 create-create conflict。
- Watch：`ignore` add、change、unlink 觸發 full sync，其他 `.wspc-drive/` event 仍不觸發。
- Regression：沒有 `ignore` file 時，既有 Drive scanner、sync 與 watch tests 維持通過。

驗證至少執行：

```bash
npm test -- test/handwritten/drive/scanner.test.ts test/handwritten/drive/sync.test.ts test/handwritten/drive/watch.test.ts
npm run typecheck
git diff --check
```

## Out of Scope

- glob、wildcard、negation 或 `.gitignore` 相容語法
- global 或 user-level exclude config
- `--exclude` CLI flags 或管理 ignore rules 的新 command
- 在 devices 間同步 `.wspc-drive/ignore`
- 內建 `.git/`、`node_modules/`、`.DS_Store` 等預設規則
- 顯示 excluded path count 或新增 sync output fields
- 針對 excluded local events 維護 watcher-side matcher optimization

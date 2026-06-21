# Drive remote manifest normalization refactor 設計

## 來源

- Todo：`tod_01KVNAS67KDKN6KAZ3FXC4453Y`
- 相關規格：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 相關規格：`docs/superpowers/specs/2026-06-21-drive-conflict-merge-policy-design.md`
- 相關規格：`docs/superpowers/specs/2026-06-21-drive-local-mutation-refactor-design.md`

## 目標

這個 refactor 要把 Drive sync 的 remote manifest validation 與 normalization 從 `src/handwritten/commands/drive/sync.ts` 抽成一個小 helper，讓 `sync.ts` 保持 orchestration：讀 state、掃 local files、分頁取得 remote manifest、套用 normalization 結果到 summary、建立 union paths、處理 action。

完成後，Drive sync 行為不改變。invalid remote path、escape root path、case-only collision、exact duplicate path、manifest pagination、blocked path、summary error count 與 path result ordering 都必須維持現狀。

## 目前味道

`fetchRemoteManifest()` 目前同時做太多事：

- 呼叫 `api.getManifest()` 並追 `next_cursor`。
- 對每個 remote entry 執行 `validateDrivePath()`。
- 用 `resolveInsideRoot()` 確認 remote path 不會寫出 sync root。
- 收集 valid candidates。
- 對 path 做 case-fold grouping。
- 分類 `REMOTE_PATH_CASE_CONFLICT` 與 `REMOTE_PATH_DUPLICATE`。
- 直接呼叫 `recordPathError()` 修改 `summary` 與 `blockedPaths`。

這些都是 remote boundary 重要 invariants，但混在 sync loop 裡會讓未來調整 manifest policy 時必須一起讀懂 summary mutation 與 full sync 流程。這是可讀性與可測性問題，不是功能缺口。

## 設計

新增一個 Drive 內部 helper module，例如：

```text
src/handwritten/commands/drive/manifest.ts
```

helper 負責 pure-ish normalization，不負責 API pagination、不負責 summary mutation、不負責 state mutation。建議 surface：

```ts
type RemoteManifestEntry = DriveManifestResponse["entries"][number]

type RemoteManifestPathError = {
  path: string
  error: Error
  appendPathResult?: boolean
}

type NormalizedRemoteManifest = {
  remoteFiles: Record<string, RemoteManifestEntry>
  pathErrors: RemoteManifestPathError[]
}

function normalizeRemoteManifest(root: string, entries: RemoteManifestEntry[]): NormalizedRemoteManifest
```

`normalizeRemoteManifest()` 的責任：

- 對每個 entry 呼叫 `validateDrivePath(entry.path)`。
- 呼叫 `resolveInsideRoot(root, entry.path)` 確認 containment。
- invalid path 回傳 `pathErrors`，不丟出到 sync loop。
- 只把通過 validation 的 entries 放進 candidate list。
- 對 candidates 依 `entry.path.toLowerCase()` grouping。
- group 長度大於一時，分辨 exact duplicate 與 case-only collision。
- 對 ambiguous group 的每個 entry 回傳 path error，並標示 `appendPathResult: true`。
- group 長度等於一時，寫入 `remoteFiles[entry.path]`。

`sync.ts` 保留 `fetchRemoteManifest()` 作為 async API orchestration。它只做：

1. 追 `api.getManifest(state.library_id, cursor)` 直到 `next_cursor` 為空。
2. 收集所有 page entries。
3. 呼叫 `normalizeRemoteManifest(root, entries)`。
4. 對 `pathErrors` 呼叫現有 `recordPathError(summary, blockedPaths, path, error, { appendPathResult })`。
5. 回傳 `remoteFiles`。

這樣抽出後，helper 可以用普通 unit tests 直接餵 entries，不需要建 temp Drive folder、fake API、state file 或跑完整 `runDriveSyncOnce()`。

## 範圍

包含：

- 新增 remote manifest normalization helper module。
- 從 `sync.ts` 移出 `validateRemoteEntry()`、case-fold grouping 與 duplicate/collision classification。
- 更新 `sync.ts` 使用 helper 回傳的 `remoteFiles` 與 `pathErrors`。
- 新增 focused helper tests，保留現有 sync integration tests。

不包含：

- 不改 manifest API pagination 行為。
- 不改 `DriveSyncApi` interface。
- 不改 `DriveSyncSummary` shape。
- 不改 `recordPathError()` 的 path ordering 或 error count 行為。
- 不改 local path scanner、sync decision table、conflict merge policy、state schema 或 realtime watch。
- 不新增 dependency、class、factory 或可設定 policy。

## Testing

遵守 TDD。最小測試集合：

- Helper tests：valid entries 會回傳 `remoteFiles`。
- Helper tests：`../escape.txt`、absolute path、backslash path 等 invalid remote path 會回傳 path error，不出現在 `remoteFiles`。
- Helper tests：case-only collision，例如 `A.txt` 與 `a.txt`，兩者都回傳 `REMOTE_PATH_CASE_CONFLICT` error。
- Helper tests：exact duplicate path，例如兩個 `dup.txt`，兩者都回傳 `REMOTE_PATH_DUPLICATE` error。
- Integration tests：現有 `sync.test.ts` 中 manifest pagination、invalid remote path、remote case-only collision、exact duplicate remote paths 行為保持通過。

建議驗證：

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/path-policy.test.ts
npm test -- test/handwritten/drive/manifest.test.ts
npm run typecheck
git diff --check
```

如果實作選擇把 helper tests 合併進 `sync.test.ts`，也可以，但優先新增 `test/handwritten/drive/manifest.test.ts`，讓 helper boundary 便宜可測。

## 接受標準

- `sync.ts` 中 `fetchRemoteManifest()` 只負責 pagination 與套用 normalization 結果。
- Remote path validation、containment check、case-fold grouping 與 duplicate classification 集中在新 helper。
- Helper 不修改 `summary`、`blockedPaths`、state 或 filesystem。
- 現有 Drive sync 測試全部通過。
- Refactor diff 沒有混入行為變更。

## Grill-me review 結論

狀態：ready。

已鎖定決策：

- 這是 readability refactor，不是新 sync behavior。
- Pagination 留在 `sync.ts`，因為它依賴 `DriveSyncApi` 與 cursor loop。
- Normalization helper 回傳資料與 path errors，由 `sync.ts` 套用到 summary。
- Helper module 不新增 dependency，也不引入 class 或 framework。

剩餘風險：

- Exact duplicate path 目前會產生兩筆同 path error。這雖然有點吵，但它是既有 observable behavior；本 refactor 必須保留，若要改成合併單筆錯誤應另開 behavior change。
- Helper 的 error object 內容會被現有 `recordPathError()` 消化，目前 CLI summary 不顯示 message；測試應鎖定 reason 字串來源，避免未來 output 擴充時失去分類資訊。

# Drive Local Mutation Refactor Design

## 目標

這個 refactor 要把 `drive sync once` 裡的本機檔案 mutation helpers 從 `src/handwritten/commands/drive/sync.ts` 搬到一個聚焦的小模組，讓 `sync.ts` 回到 orchestration：掃描、取得 manifest、決定 action、呼叫 API、寫 state、更新 summary。

完成後，Drive sync 行為不改變。download、delete local、clean merge install、conflict copy reuse、backup restore、state write failure 的安全語意都必須維持現狀。

## 目前味道

`src/handwritten/commands/drive/sync.ts` 同時包含 sync loop、remote manifest 處理、conflict policy、state commit、summary 更新，以及一整組本機 disk mutation 細節。檔案目前超過一千行，其中 download install、merged local install、local delete、hard-link no-overwrite install、backup restore、local existence checks 都是低階 disk invariants。

這些 invariants 很重要，但它們擠在 `processPath()` 與 conflict flow 旁邊，讓未來修改 Drive sync policy 時必須同時讀懂 temp file、backup、restore 與 race handling。這是可讀性與變更風險問題，不是功能缺口。

## 設計

新增一個 Drive 內部模組，例如 `src/handwritten/commands/drive/local-mutations.ts`。此模組只處理本機檔案 mutation 與相關 guard。

建議搬入的責任：

- `downloadRemote()` 與 `installDownloadedFile()`。
- `writeMergedLocalFile()`、`installMergedLocalFile()`、`restoreMergedLocalFile()`。
- `removeLocalIfStillBase()`。
- `installNoOverwrite()`、`restoreBackupWhenPossible()`、`localFileExists()`、`localMutationBackupPath()`。
- `assertLocalStillScanned()`、`assertLocalSafeForDownload()`、`assertLocalAbsentBeforeRemoteDelete()`。
- `readStableUploadBody()` 若搬出後能減少 sync orchestration 噪音，也可以一起搬；若型別牽動較大，可留在 `sync.ts`。

模組需要的 public surface 應該很小，偏向匯出目前 `sync.ts` 真正呼叫的幾個高階操作，而不是匯出每個低階 helper。低階 helper 留在新模組私有即可。

`sync.ts` 保留：

- `runDriveSyncOnce()`。
- `fetchRemoteManifest()` 與 path/action union。
- `processPath()` 的 action dispatch。
- conflict policy 與 state mutation。
- summary 計數與 `recordUnresolvedConflicts()`。

## 範圍

包含：

- 新增 Drive local mutation helper module。
- 從 `sync.ts` 移出 disk mutation helpers。
- 更新 import 與型別。
- 保留現有測試，必要時只新增一兩個聚焦測試補足 module boundary。

不包含：

- 不改 sync decision table。
- 不改 conflict merge policy。
- 不改 remote manifest handling。
- 不改 `.wspc-drive/state.json` schema。
- 不新增 stale lock recovery、operation queue、rename detection 或 ignore rules。

## 實作提示

先跑現有 Drive sync 測試確認 baseline。接著搬 helper，保持函式名稱與錯誤字串盡量不變，讓現有測試直接保護行為。

如果新模組需要 callback，例如 local mutation 發生時標記 `durableStateRequired = true`，沿用目前 `onLocalMutation` callback，不要引入 class 或 event emitter。

`sync.ts` 中仍需要能在 state write failure 後判斷是否停止後續 paths，因此 high-level helper 回傳值不要藏掉「本機已 mutation」這件事。最小做法是保留現在 callback 形狀。

## 測試

最小驗證：

- `npm test -- test/handwritten/drive/sync.test.ts`
- `npm test -- test/handwritten/drive/merge.test.ts`
- `npm run typecheck`
- `git diff --check`

若拆出後新增 module-level tests，鎖定本機 mutation boundary，例如 download install rollback 或 merge restore，不需要複製整套 sync scenario。

## 接受標準

- `sync.ts` 明顯少掉本機 disk mutation helper，主要閱讀路徑集中在 sync orchestration。
- 現有 Drive sync 測試全部通過，尤其是 state write failure、merge install race、download hash mismatch、delete local race、conflict copy reuse。
- 新模組沒有新增 dependency。
- 沒有行為性變更混入 refactor diff。

# Drive watch 不再因 move 被拒而永久卡在 HTTP 409

## Problem Statement

身為用 wspc-drive app（背後執行 `wspc drive watch`）同步 library 的使用者，我在本機一次改名或搬移大量檔案後，想要同步在中途被停掉也能自己接續完成；就算某一組改名被 server 拒絕，其他檔案仍照常同步，而且看得出是哪一組、為什麼被拒。

2026-09-24，`personal` library（約 5,300 個檔案）在本機大量改名後，wspc-drive `events.log` 從 08:58 UTC 起每次啟動 watch 都在 1–3 秒內以 `cli error: error: HTTP 409` 結束，持續到 23:39 仍未恢復。Workers Logs 顯示：

- 08:46–08:57 之間 `@wspc/cli/0.13.1` 成功呼叫 `POST /drive/libraries/{id}/files/move` 約 323 次，每次 server wall time 平均 1,980 ms（p95 2,863 ms）。這段期間 `events.log` 只有 `sync started`，沒有任何進度；watch 在 08:52:25 與 08:57:39 兩度被停止，兩次都停在 move 階段。
- 08:58 之後 move 0 次成功、43 次 `409`，與 `events.log` 的 44 行 `HTTP 409` 對應。
- 同一時段 manifest 請求依序為 `since_cursor=…20439`（08:52）、`since_cursor=…20811`（08:58）。20811 − 20439 = 372，約等於第一輪 186 次 move × 每次兩筆 coordinator event。

根因有兩個，第一個讓 state 過期，第二個讓過期變成永久卡住：

1. **Manifest cursor 在處理前就寫入。** `runDriveSyncOnce()` 取得 manifest（delta 或 full）後立刻把 `latest_cursor` 寫進 `state.json`，接著才執行 `applyRenamesAsMoves()` 與逐 path 處理。這一輪若在處理完前被中斷，下一輪從新 cursor 取 delta，已被跳過的變動不會再出現；`remoteViewFromState()` 用 state 裡的舊 entry 當作遠端現況。
   - 09-24 的順序：第 1 輪最後一個 move 在 server 已完成、state 未寫入就被停止。第 2 輪的 delta 帶回該 move 的兩筆 event（舊 path 刪除、新 path 出現），本應在逐 path 處理時以 `remove_state`／`state_only` 修正，但它先寫入新 cursor，再花 5 分鐘做剩下的 138 個 move，未走到逐 path 處理就又被停止。第 3 輪的 delta 不含那兩筆 event，state 仍記著舊 path 與舊 Entry Version，本機只有新 path 且內容相同，於是再配成 move。Server 上該 entry 早已在新 path，回 `409 VERSION_CONFLICT`。
   - 同一機制也會讓其他裝置的修改在中斷後永遠不被下載（delta 被跳過、state 仍是舊版）。
2. **Move 被拒時整輪中止，而且沒有任何狀態改變。** `applyRenamesAsMoves()` 不攔截 `moveFile()` 的錯誤，依 [Drive desktop CLI sync v1 spec](2026-06-21-drive-desktop-cli-sync-v1-design.md) 的「Move 失敗停止，不再 fallback upload＋delete」往外丟，watch 視為非 retryable 錯誤而結束 process。state 未變，下一次啟動配出同一組 move，永遠重複。

另外兩個問題讓它難以診斷：

- 最外層只印 `error: HTTP 409`，`DriveHttpError.code`（例如 `VERSION_CONFLICT`、`PATH_CONFLICT`）沒有輸出；`debug.log` 只在 move 成功後記錄，失敗的那組 path 沒有紀錄。
- `onProgress` 在所有 move 做完之後才第一次呼叫，大量改名時 UI 長時間停在 `sync started`，看起來像卡住，使用者因此停止 watch，觸發了根因 1。

限制：`state.json` 維持 `schema_version: 1`，不新增欄位；`drive_sync_once`、`drive_sync_progress`、`drive_watch_retry` 與 `path_errors` 的 event contract 不變。沿用 [backend move/delete confirmation spec](https://github.com/sadcoderlabs/wspc/blob/bb461ad3299ba16ecd5b9e37f3bc313b25e52595/docs/superpowers/specs/2026-09-09-drive-move-delete-confirmation-design.md)：move 一律送出 state 保存的原確認（entry ID、path、Entry Version），不以 fresh lookup 替換；move 被拒時不 fallback 成 upload＋delete。

## Solution

### Manifest cursor 在整輪處理完才寫入

一輪 sync 取得的 manifest cursor，只在該輪所有 move 與逐 path 處理都跑完之後才寫入 `state.json`。以下情況不寫入，下一輪沿用舊 cursor 重新取得同一段 delta：

- 這一輪丟出錯誤（包含 retryable 的 `DriveRetryableSyncError`、auth failure 與 process 被停止）。
- 逐 path 處理因 state 寫入失敗而提前停止（`result.stop`）。

重播同一段 delta 是安全的：已套用到 state 的 path，delta 內容與 state 相同，決策為 `unchanged`；server 已完成但 state 未寫入的 move，會以 `remove_state`（舊 path）與 `state_only`（新 path）補上。

### Move 被拒時的處理（Move Rejection）

`moveFile()` 丟出的錯誤若是 retryable（429、5xx、network）或 auth failure（401／403），維持現行行為往外丟。其餘錯誤（例如 `409 VERSION_CONFLICT`、`409 PATH_CONFLICT`、其他 4xx）視為 Move Rejection：

1. **本輪用的是 delta 時**：不再執行剩下的 move，改為忽略 cursor 重新取得 full manifest，以新的遠端現況重新判斷改名配對，再繼續執行。每輪最多重新取得一次。原確認不變：若 full manifest 顯示舊 path 已不在遠端，這組不再被視為改名（由逐 path 處理補 state）；若仍配成同一組，送出的仍是 state 裡的原確認。
2. **本輪用的已經是 full manifest 時**：這組的兩個 path 本輪都不處理（不 upload、不 delete），以一筆 path error 回報在新 path 上，`code` 為 server 回傳的錯誤碼（無則 `DRIVE_PATH_ERROR`），`message` 為 `move from <舊 path> rejected (HTTP <status>)`，`retryable: false`。其他 move 與其他 path 照常處理，`errors` 計入 1。下一輪會再嘗試一次，不會讓 watch 結束。

### 進度

`onProgress` 在執行任何 move 之前先回報 `(0, total)`，`total` 包含本輪預計執行的 move 數量；每完成（或被拒）一個 move，`processed` 加 1。重新取得 full manifest 後若 `total` 改變，以新的 `total` 再回報一次目前進度。

### 診斷

- `debug.log`（`--debug` 或 `WSPC_DRIVE_DEBUG=1`）新增：
  - `manifest`：`mode`（`delta`／`full`）、`since_cursor`（delta 時）、`latest_cursor`、`entries`（筆數）、`resync_required`（delta 被 server 要求改抓 full 時）。
  - `move_rejected`：`from_path`、`to_path`、`entry_id`、`expected_entry_version`、`status`、`code`、`action`（`refetch_full_manifest` 或 `skip_pair`）。
  - `manifest_cursor`：`action: "persist"` 與寫入的 cursor；或 `action: "keep"` 與原因（`round_interrupted`）。
- CLI 最外層錯誤輸出：錯誤物件同時帶有數字 `status` 與字串 `code`，且 message 不含該 code 時，輸出 `error: <message> (<code>)`，例如 `error: HTTP 409 (VERSION_CONFLICT)`。其他錯誤輸出不變。

## Acceptance Criteria

所有自動化驗證在本機與 CI 執行 `npm test`，使用 vitest、暫存 library 與 fake Drive API；不需要真實帳號或網路。

1. **兩次中斷後可收斂**：以有狀態的 fake server（entry ID、path、Entry Version、coordinator event 與 cursor，確認規則同 server `files-repo.ts`）重現 09-24 時序：四個檔案在本機改名，第 1 輪在 server 完成第 2 個 move 後中斷，第 2 輪在完成第 3 個 move 後中斷。之後連續三輪 `runDriveSyncOnce()` 都不丟錯，最後 state 只有改名後的四個 path，server 上也是這四個 path。改動前三輪皆為 `HTTP 409`。自動化，CI。
2. **中斷後不遺失遠端修改**：其他裝置修改檔案後，本輪在下載時因 `fetch failed` 中斷；下一輪會下載到新內容。改動前本機仍是舊內容。自動化，CI。
3. **cursor 寫入時機**：delta 取得新 cursor 後，若處理中丟錯或因 state 寫入失敗提前停止，`state.json` 的 `manifest_cursor` 維持原值；整輪完成時為新值（既有 delta／full／expired cursor 測試的期望值不變）。自動化，CI。
4. **delta 下 move 被拒會改抓 full manifest**：delta 的遠端現況過期導致 move 回 `409 VERSION_CONFLICT` 時，同一輪呼叫一次 full manifest，並以 full manifest 的結果完成同步，summary `errors === 0`；不呼叫 upload 或 delete 補做那組改名。自動化，CI。
5. **full manifest 下 move 被拒只影響那一組**：move 回 `409 PATH_CONFLICT`（或其他非 retryable 4xx）時，`runDriveSyncOnce()` 不丟錯；該組兩個 path 沒有 upload／delete；`path_errors` 有一筆 `{ path: <新 path>, code: "PATH_CONFLICT", message: "move from <舊 path> rejected (HTTP 409)", retryable: false }`；同一輪其他檔案正常上傳。自動化，CI。
6. **retryable 與 auth 維持原行為**：move 回 429 仍以 `DriveRetryableSyncError` 中止；回 403 仍往外丟；都不 upload／delete（既有測試）。自動化，CI。
7. **進度包含 move**：兩組改名加一個新檔時，`onProgress` 依序收到 `[0,3]`、`[1,3]`、`[2,3]`、`[3,3]`。自動化，CI。
8. **診斷輸出**：move 被拒時 `debug.log` 有 `move_rejected` event，欄位如上；`dispatch()` 對帶 `status` 與 `code` 的錯誤輸出 `error: HTTP 409 (VERSION_CONFLICT)`。自動化，CI。
9. **Repository checks**：`npm run typecheck`、`npm test`、`npm run build` 通過。CI。
10. **Live 驗收（post-release，非 merge gate）**：CLI 發佈且 wspc-drive 使用新版後，在卡住的 `personal` library 啟動 watch，第一輪即完成同步，`events.log` 不再出現 `HTTP 409`。需要使用者本機 wspc-drive，手動。

## Implementation Decisions

- **cursor 延後寫入**：`fetchRemoteManifest()` 仍回傳 `manifestCursor`，但不在取得後立即寫入；改在逐 path 迴圈正常結束（非 `stop`）後、`recordUnresolvedConflicts()` 之前，以同樣的條件（`excludeRules.size === 0`、cursor 有定義且與 state 不同）寫入。
- **改名配對拆成規劃與執行**：`planRenameMoves()` 回傳 1:1 的 `{ fromPath, toPath }` 清單（純函式，規則不變）；`applyRenameMoves()` 依序執行，回傳 `movedPaths` 與 `rejected`。Move Rejection 的判斷用 `retry.ts` 既有的 `isRetryableDriveFailure()` 與 `isDriveAuthFailure()`。
- **重新取得 full manifest**：以 `{ ...state, manifest_cursor: undefined }` 呼叫 `fetchRemoteManifest()`，不寫入 state；本輪結束時寫入的是 full manifest 的 `latest_cursor`。manifest normalization 產生的 path error 由 `recordDrivePathError()` 以 path 去重，不會重複計數。
- **跳過被拒的組合**：兩個 path 加入與 Oversized File、Permanent Upload Rejection 相同的略過集合，不計入逐 path 的 `total`。
- **為什麼不記成 conflict**：這個 repo 的 conflict 指內容衝突，會觸發 conflict copy 與持久化的 `state.conflicts`；Move Rejection 是改名確認失敗，內容沒有衝突，因此以本輪 path error 回報，下一輪自動再判斷。
- **錯誤輸出**：在 `src/cli.ts` 的 `dispatch()` 處理；不改 `DriveHttpError.message`，避免 path error 的 `message` 與 wspc-drive dashboard 的 `HTTP 413` 判斷改變。
- **Rollout／rollback**：隨下一個 CLI release 發佈，wspc-drive 升級內附 CLI 即生效。state 格式不變，回退只會恢復舊行為。
- **外部服務**：無新增服務、credential 或 server 改動。

## Testing Decisions

| AC | 驗證 |
| --- | --- |
| 1、2 | `test/handwritten/drive/sync-interruption.test.ts`：有狀態 fake server，多輪呼叫 `runDriveSyncOnce()`。 |
| 3、4、5、7、8（debug） | `test/handwritten/drive/sync.test.ts`：沿用 `mkApi` 與暫存 library。 |
| 6 | 既有 `sync.test.ts` move 429／403 測試。 |
| 8（CLI 輸出） | `test/cli-json-error.test.ts` 或同層既有 `dispatch()` 測試。 |

既有測試 `stops without upload or delete when move has a permanent failure` 斷言 move 一般錯誤會讓整輪中止；新行為改為回報 path error 並繼續。該斷言的修改獨立成一個 commit。

## Out of Scope

- **server move 延遲**：每次 move 約 2 秒是 server 端（`drive-worker` 的 `files/move`）的 wall time，不在 CLI。大量改名仍會花很久，需在 wspc repo 另外處理（例如批次 move API）。
- **逐 path 永久錯誤與 cursor**：某 path 本輪記錄 path error 但整輪完成時，cursor 仍會前進；若該錯誤剛好發生在一個遠端變動上（例如非 retryable 的下載失敗），那個變動在下一輪的 delta 中不會再出現。本次只處理「整輪中斷」。
- **Server 端通知遺失**：`files-service.ts` 發送 coordinator 通知時以 `.catch(() => undefined)` 吞掉錯誤，遺失的 event 不會出現在 delta。這次事件沒有證據顯示發生過，另行追蹤。

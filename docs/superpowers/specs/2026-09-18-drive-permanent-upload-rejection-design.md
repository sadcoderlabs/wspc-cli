# Drive watch 不再重傳被永久拒收的檔案

來源 Todo：`tod_01M2S8NHVDB66Y6971M4D1269V`。相關：`tod_01M2S85BY0A38RM37TMNC4KTDY`（413 錯誤碼與大檔上傳）。

## Problem Statement

身為用 wspc-drive app（背後執行 `wspc drive watch`）同步 library 的使用者，我想要一個 server 傳不上去的檔案只被嘗試一次、然後停在「需要處理」，以便頻寬與 CPU 不會被每幾秒一次的整檔重傳吃掉；我修改、改名、刪除或排除該檔後，同步要自動重新處理它，其他檔案照常同步。

2026-09-15 起，一個 291 MB 的 `health/tempo/google-health/2026/09/records/heart-rate.jsonl` 每次上傳都被拒收（`HTTP 413`，回報為 `DRIVE_PATH_ERROR`、`retryable: false`）。wspc-drive `events.log` 到 2026-09-18 累積 444 次 `drive_sync_once errors 1`，watch process 沒有重啟。該 library 的 `.wspc-drive/debug.log` 顯示：

- 最近 71 次 `sync_start` 中 60 次 `trigger: local`、10 次 `retry`；同期 71 次 `fs_event` 全部是 root `.DS_Store`，而 `.wspc-drive/ignore` 已有 `**/.DS_Store*`。
- 每輪唯一的 actionable path 是 heart-rate.jsonl；約一半上傳回 `HTTP 413`，另一半回 `HTTP 502` 並被歸為 transient，以 1s→2s backoff 重試。
- 每輪 4–6 秒，上一輪期間收到的 `.DS_Store` event 讓下一輪在同一毫秒開始。

根因有兩個：

1. `executeDrivePathAction()` 上傳失敗時只把錯誤放進該輪 `summary.path_errors`，不寫入 `.wspc-drive/state.json`。下一輪 `decideDriveAction()` 仍判定 `upload_update`，重讀並重傳整個檔案；任何 sync 觸發都會重傳。
2. `runDriveWatch()` 對 excluded path 的本機 fs event 照樣排程 sync。[Exclude rules spec](2026-07-24-drive-sync-exclude-rules-design.md) 當時延後 watcher 端 matcher，理由是這些 sync 只是 no-op；但只要有一個失敗檔，每輪都是一次整檔上傳。Finder 開著資料夾會持續改寫 `.DS_Store`，形成迴圈。

限制：`state.json` 維持 `schema_version: 1`，只新增 optional 欄位；`drive_sync_once`、`drive_sync_progress`、`drive_watch_retry` 與 `path_errors` 的 event contract 不變，wspc-drive dashboard 依此顯示「1 file needs attention」。[Drive sync watch spec](2026-06-21-drive-sync-watch-design.md) 與 exclude rules spec 的其他契約持續適用。

## Solution

### Permanent Upload Rejection

上傳請求（`upload_create` 或 `upload_update`）收到 server 的 HTTP 4xx，且 status 不是 401、403、408、409、429，也不是 `VERSION_CONFLICT`，視為 Permanent Upload Rejection。本機讀檔錯誤、`local file changed after scan`、network error 與 5xx 都不是。

發生 Permanent Upload Rejection 時，sync 除了照舊回報該輪 path error，還會在 `state.json` 記住這份內容被拒收，fingerprint 是該 path 本輪 scan 的 `mtime_ms`、`size_bytes`、`sha256`，並帶當下錯誤的 `code`、`message` 與執行中的 CLI version。

### 後續輪次

每輪 sync（watch 的 local、remote、retry、initial 觸發，以及 `wspc drive sync once`）scan 之後：

- 某 path 的決策是 upload，且有 rejection 紀錄，其 fingerprint 與本輪 scan 完全相同、CLI version 與執行中版本相同：不讀檔、不上傳。該輪 `drive_sync_once` 帶一筆 `path_errors`，`code`、`message` 與紀錄相同、`retryable: false`；`errors` 計入 1，`paths` 中該 path 的 `action` 為 `error`；`sync once` exit code 仍為 1。該 path 不計入 `drive_sync_progress` 的 `total`。
- `mtime_ms`、`size_bytes`、`sha256` 任一不同（包含只 `touch`），或 CLI version 不同：清掉紀錄，照一般流程上傳一次；再次被永久拒收就用新 fingerprint 重新記錄。
- 該 path 已不在本機 scan 結果中（刪除、改名、被 exclude rule 排除）：清掉紀錄，之後不再回報。
- 上傳成功時清掉紀錄。
- 決策不是 upload（例如 remote 同時變動成 conflict）時，紀錄不影響該輪行為，照一般 conflict 流程處理。

Transient failure（429、5xx、network）維持現行 backoff 與不設 attempt cap 的契約。

### Watch 觸發

watch 啟動時載入 `.wspc-drive/ignore` 的 exclude rules；本機 fs event 的 path 符合 exclude rule 時，不加入 dirty paths、不排程 sync。`.wspc-drive/ignore` 的 add、change、unlink 仍排程 full sync，並在排程前重新載入規則。`ignore` 無法解析時 watcher 不過濾任何 path，錯誤由 sync 照現行契約回報。Remote realtime event 行為不變。

## Acceptance Criteria

所有自動化驗證在本機與 CI 執行 `npm test`，使用 vitest 與既有 fake Drive API／fake watch source／fake timer；不需要真實帳號或網路。

1. **只拒收一次**：fake API 對某檔每次上傳都丟 `DriveHttpError(413)`。連續三輪 `runDriveSyncOnce()` 且檔案不變，`uploadFile` 對該 path 只被呼叫 1 次；三輪 summary 都有同一筆 `path_errors`（`path`、`code: "DRIVE_PATH_ERROR"`、`message: "HTTP 413"`、`retryable: false`），`errors === 1`。自動化，CI。
2. **不產生假進度**：第 2 輪 `onProgress` 收到的 `total` 不含被略過的 path（只有該檔時為 `0`）。自動化，CI。
3. **state 紀錄與相容性**：第 1 輪後 `state.json` 有該 path 的 rejection 紀錄（fingerprint、code、message、CLI version、時間）；舊版沒有此欄位的 `state.json` 可讀；欄位形狀錯誤時 `readDriveState()` 以現行 `unsupported .wspc-drive/state.json schema` 拒絕。自動化，CI。
4. **內容或 metadata 變動會重試**：分別修改內容、只改 `mtime`（`utimes`）後的下一輪，`uploadFile` 各再被呼叫 1 次。自動化，CI。
5. **刪除、改名、排除會清除**：分別刪除檔案、改名、在 `.wspc-drive/ignore` 加入該 path 後的下一輪，summary 不再有該 path 的 `path_errors`，`state.json` 不再有該紀錄；改名後的新 path 會上傳一次。自動化，CI。
6. **CLI 升級會重試**：`state.json` 的紀錄 CLI version 與執行中不同時，下一輪上傳 1 次。自動化，CI。
7. **上傳成功會清除**：有紀錄的 path 在 fingerprint 變動後上傳成功，紀錄被移除。自動化，CI。
8. **非永久失敗不記錄**：上傳丟 502、429、408、401／403、`VERSION_CONFLICT`（409）、本機讀檔錯誤或 `local file changed after scan` 時，不寫入 rejection 紀錄，下一輪照現行行為再試或處理。自動化，CI。
9. **其他檔案不受影響**：同一輪另一個檔案正常上傳；下一輪被略過的檔案之外的新變動仍正常同步。自動化，CI。
10. **excluded path 不觸發 watch**：`ignore` 含 `**/.DS_Store*` 時，fake watch source 發出 `.DS_Store` event 不呼叫 `runSync`；未被排除的 path 仍觸發；改寫 `ignore` 移除規則後，`.DS_Store` event 會觸發 sync；`ignore` 本身的 event 仍排程 full sync。自動化，CI。
11. **Repository checks**：`npm run typecheck`、`npm test`、`npm run build` 通過。CI。
12. **Live 驗收（post-release，非 merge gate）**：CLI 發佈且 wspc-drive 使用新版後，在 `~/.hermes/profiles/pocketshark/library` 以 `--debug` 執行的 watch，`debug.log` 對 heart-rate.jsonl 每個 fingerprint 最多一次 `op: "process"` 上傳錯誤，之後輪次沒有該檔的上傳；`.DS_Store` 的 fs event 不再接著 `sync_start`。需要使用者本機 wspc-drive 與既有 CLI 登入，手動。

## Implementation Decisions

- **State 欄位**：`DriveState` 新增 optional `upload_rejections?: Record<string, DriveUploadRejection>`，`DriveUploadRejection` 為 `{ mtime_ms: number; size_bytes: number; sha256: string; code: string; message: string; cli_version: string; rejected_at: string }`。`rejected_at` 用 `driveIsoTimestamp(clock)`。`isValidDriveState()` 驗證此欄位與每筆紀錄形狀，比照 `scan_errors`。空 record 時刪除欄位，不寫空物件。`schema_version` 不變。
- **CLI version**：使用 `src/version.ts` 的 `VERSION`。
- **判定**：在 `retry.ts` 新增 `isPermanentUploadRejection(error)`：`error instanceof DriveHttpError`、`400 <= status < 500`、status 不在 `{401, 403, 408, 409, 429}`、`code !== "VERSION_CONFLICT"`。只在 `executeDrivePathAction()` 的 upload 分支、`api.uploadFile()` 丟出時判定；讀檔（`readStableUploadBody`）失敗不判定。
- **記錄**：upload 分支 catch 到 Permanent Upload Rejection 時，以 `state.scan_cache[path]` 為 fingerprint；若沒有 cache entry 或其 `sha256` 與本次 upload digest 不同，則不記錄（本輪 path error 照舊）。寫入 `state.json` 後回傳新 state，並照現行 `recordDrivePathError()` 回報。上傳成功分支不需另外刪除紀錄：會走到上傳的 path，其紀錄已在下述略過與清除步驟因 fingerprint 或 CLI version 不同而刪除。
- **略過與清除**：`runDriveSyncOnce()` 在 scan 完成、`applyRenamesAsMoves()` 之後、計算 progress `total` 之前，針對每筆紀錄：本輪 scan cache 沒有該 path（刪除、改名、被 exclude rule 排除或 scan error；scan cache 與 `localFiles` 涵蓋相同 path）、fingerprint 不同或 `cli_version !== VERSION` 就刪除；其餘若本輪決策為 `upload_create`／`upload_update`，將 path 加入略過集合，並以 `recordDrivePathError(..., { op: "upload_rejected", pathError: { path, code, message, retryable: false } })` 回報。略過集合的 path 不計入 `total`、不呼叫 `executeDrivePathAction()`。紀錄有變動才寫 `state.json`。Excluded path 不會出現在 scan cache，由此步驟清除，`removeExcludedState()` 不需另外處理。Incremental scan 下 `localFiles` 仍涵蓋完整本機 view（由 scan cache 補齊），故上述判斷在 local-trigger 輪次同樣成立。
- **Watch**：`runDriveWatch()` 啟動時以 `loadDriveExcludeRules(root)` 載入規則，失敗（包含 `DriveIgnoreError`）時使用不過濾的 matcher。`onChange` 在 internal path 與 temp artifact 判斷之後、加入 `dirtyPaths` 之前，以 `excludeRules.matches(drivePath)` 過濾；`ignore` event 先重新載入規則再排程 full sync。`path === undefined` 的 event 維持 full reconciliation。
- **Debug log**：略過時沿用 `error` debug event，`op: "upload_rejected"`，方便與實際上傳失敗（`op: "process"`）區分。
- **Rollout／rollback**：隨下一個 CLI minor release 發佈，wspc-drive 升級內附 CLI 即生效，不需 app 改動。舊版 CLI 讀到含 `upload_rejections` 的 `state.json` 時，現行 validator 忽略未知欄位，回退只會恢復舊的重傳行為。
- **外部服務**：無新增服務、credential 或 server 改動。

## Testing Decisions

| AC | 驗證 |
| --- | --- |
| 1、2、4、5、6、7、9 | `test/handwritten/drive/sync.test.ts`：沿用 fake `DriveSyncApi` 與暫存 library，多輪呼叫 `runDriveSyncOnce()`，斷言 `uploadFile` 呼叫次數、summary、`onProgress` 與 `state.json`。 |
| 8 | `test/handwritten/drive/retry.test.ts` 對 `isPermanentUploadRejection()` 做 status 表格測試；`path-executor.test.ts` 或 `sync.test.ts` 驗證 502、`VERSION_CONFLICT`、讀檔錯誤不寫紀錄。 |
| 3 | `test/handwritten/drive/state.test.ts`：有／無欄位可讀、形狀錯誤被拒。 |
| 10 | `test/handwritten/drive/watch.test.ts`：fake watch source 與 fake timer，斷言 `runSync` 是否被呼叫與 `ignore` 重新載入。 |
| 11 | CI 的既有 typecheck、test、build job。 |
| 12 | Post-release 手動檢查使用者本機 `debug.log`；需要真實大檔、server body limit 與 Finder 行為，無法在 CI 重現。不阻擋 merge，結果回報在實作 PR 或 Todo comment。 |

實作依 TDD：每個 AC 先寫失敗測試，確認失敗原因是缺少行為（例如 AC 1 第二輪 `uploadFile` 被呼叫 2 次），再實作。

## Out of Scope

- 大檔 chunked／resumable upload，以及 413 對應 `FILE_TOO_LARGE` 錯誤碼：由 `tod_01M2S85BY0A38RM37TMNC4KTDY` 處理。本 spec 沿用當下的 `code`／`message`；該 Todo 發佈新版時，AC 6 的 CLI version 規則會讓被拒收的檔案自動重試。
- 同一檔上傳持續只回 5xx、永遠拿不到 4xx 時的 retry cap：現行契約明訂 transient failure 不設 attempt cap；有實際證據顯示永遠不會出現 4xx 時再開。
- 重啟 watch 時自動重試：wspc-drive 在 sleep/resume 會重啟 watch，會讓大檔重傳頻率回升。
- conflict 流程（`resolveConflictWithLocalAsMain()`、clean merge）中的上傳被永久拒收時的記憶；目前沒有證據，出現時再開。
- wspc-drive app UI（例如「重試」按鈕）與手動清除紀錄的 CLI 指令：使用者可改檔、改名、排除或升級 CLI 觸發重試；有需求時再開。

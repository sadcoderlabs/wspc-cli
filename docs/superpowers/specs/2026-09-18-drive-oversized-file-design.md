# Drive sync 明確回報超過單檔上限的檔案

來源 Todo：`tod_01M2S85BY0A38RM37TMNC4KTDY`。相關：[Drive watch 不再重傳被永久拒收的檔案](2026-09-18-drive-permanent-upload-rejection-design.md)。

## Problem Statement

身為用 `wspc drive sync once`／`wspc drive watch`（以及背後執行 watch 的 WSPC Drive app）同步 library 的使用者，我想要在 library 裡有太大的檔案時，一眼看出「這個檔案太大、多大、上限多少」，而且 sync 不去上傳注定會被拒收的檔案，以便決定排除、拆檔或搬出 library，同時不浪費頻寬、記憶體與 CPU。

現況：

- Drive server 的單檔上限是 100 MiB（`MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024`），超過時回 JSON `413`、`code: "FILE_TOO_LARGE"`。這個上限沒有透過 API 公開，也沒有 multipart／resumable upload endpoint；唯一的上傳方式是 `PUT /drive/libraries/{id}/files/content` 單一請求。
- 2026-09-15 起，一個 291 MB 的 `heart-rate.jsonl` 每次上傳都收到**沒有** JSON `code` 的 `HTTP 413`，推測是 edge 在 worker 之前擋下。CLI 因此把它回報為 `DRIVE_PATH_ERROR`、`message: "HTTP 413"`，WSPC Drive 顯示 `DRIVE_PATH_ERROR: HTTP 413`，看起來像路徑問題。
- 上傳前，CLI 會先把整個檔案讀進記憶體（`readStableUploadBody()`），再整檔送出。
- CLI 0.13.0 的 Permanent Upload Rejection 讓同一份內容只傳一次；但持續成長的檔案（例如每天 append 的 `.jsonl`）每次變動都是新 fingerprint，仍會整檔讀取、上傳並被拒一次。
- WSPC Drive PR sadcoderlabs/wspc-drive#92（open）已把 `code === "FILE_TOO_LARGE"` 或 message 含 `HTTP 413` 的 path error 顯示為白話訊息。

限制：`drive_sync_once`、`drive_sync_progress`、`drive_watch_retry` 與 `path_errors` 的 event contract 不變；`state.json` 維持 `schema_version: 1` 且不新增欄位；不需要 server 改動即可發佈。

## Solution

### Oversized File

本機檔案的 scan `size_bytes` 大於 `104857600`（100 MiB）時，該檔是 Oversized File。剛好 `104857600` bytes 不是。

每輪 sync（watch 的 initial、local、remote、retry、ignore 觸發，以及 `sync once`）scan 之後，若某 path 的決策是 `upload_create` 或 `upload_update`，且是 Oversized File：

- 不讀取檔案內容、不呼叫上傳 API。
- 該輪 `drive_sync_once` 帶一筆 `path_errors`：`code: "FILE_TOO_LARGE"`、`retryable: false`、`message` 為 `file is <X> MiB (<N> bytes); Drive per-file limit is 100 MiB`，`<X>` 為 `N / 1048576` 取一位小數，`<N>` 為 scan 的 `size_bytes`。
- `errors` 計入 1；`paths` 中該 path 的 `action` 為 `error`；`sync once` exit code 為 1。
- 該 path 不計入 `drive_sync_progress` 的 `total`。
- 同一輪其他 path 照常處理。

不寫入 `state.json`：這項檢查只看 scan 結果，每輪重新判定。因此檔案縮小到 100 MiB 以內、被刪除、改名或被 exclude rule 排除後，下一輪自然不再回報；縮小後的檔案照一般流程上傳。

決策不是 upload（例如 remote 同時變動而成為 conflict）時，不做這項檢查，照一般 conflict 流程處理。

### HTTP 413

任何 Drive API 回應 HTTP 413 且 body 沒有可用的 `code` 時，視為 `code: "FILE_TOO_LARGE"`。body 有 `code` 時沿用 server 的 `code`。因此上傳收到 413 時，path error 的 `code` 為 `FILE_TOO_LARGE`、`message` 維持 `HTTP 413`、`retryable: false`，並照既有 Permanent Upload Rejection 規則記錄、不重傳同一份內容。

### 與 Permanent Upload Rejection 的關係

同一輪中，Oversized File 的判定先於 Permanent Upload Rejection 的略過判定；一個 path 在同一輪只回報一筆 path error。舊版 CLI 留下、`code` 為 `DRIVE_PATH_ERROR` 的拒收紀錄，會因 CLI version 不同而被既有規則清除，之後改由 Oversized File 回報。

## Acceptance Criteria

所有自動化驗證在本機與 CI（`ubuntu-latest`）執行 `npm test`，使用 vitest、暫存 library 與既有 fake `DriveSyncApi`，不需要真實帳號或網路。Oversized File 以 sparse file（`truncate` 到指定大小）建立，不佔實際磁碟空間。

1. **不讀不傳**：library 內有 `104857601` bytes 的檔案。連續兩輪 `runDriveSyncOnce()`，`uploadFile` 對該 path 呼叫 0 次；兩輪 summary 都有 `{ path, code: "FILE_TOO_LARGE", message: "file is 100.0 MiB (104857601 bytes); Drive per-file limit is 100 MiB", retryable: false }`，`errors === 1`，`paths` 為 `[{ path, action: "error" }]`。自動化，CI。
2. **不計入進度、其他檔案照常**：同一 library 另有一個新的小檔。該輪 `onProgress` 收到的 `total` 為 `1`，小檔上傳 1 次，`uploaded === 1`。自動化，CI。
3. **邊界**：剛好 `104857600` bytes 的新檔照常上傳 1 次，沒有 path error。自動化，CI。
4. **已同步的檔案長大超過上限**：state 中已有該 path、本機檔案長到 `104857601` bytes（決策為 `upload_update`），`uploadFile` 呼叫 0 次並回報 `FILE_TOO_LARGE`。自動化，CI。
5. **恢復**：分別把檔案縮小到 100 MiB 以內、刪除、改名、在 `.wspc-drive/ignore` 加入該 path 後的下一輪，summary 不再有該 path 的 `path_errors`；縮小與改名後各上傳 1 次（改名後的新 path 仍超過上限時則回報新 path 的 `FILE_TOO_LARGE`，不上傳）。自動化，CI。
6. **HTTP 413 對應**：`driveHttpError()` 收到 status 413、body 無 `code` 時，產生的 `DriveHttpError.code === "FILE_TOO_LARGE"`；body 有 `code: "SOMETHING_ELSE"` 時沿用 `SOMETHING_ELSE`。fake upload 丟出 413（無 code）時，sync summary 的 path error 為 `code: "FILE_TOO_LARGE"`、`message: "HTTP 413"`、`retryable: false`，且 `state.json` 的 `upload_rejections` 紀錄 `code` 為 `FILE_TOO_LARGE`。自動化，CI。
7. **舊拒收紀錄轉換**：`state.json` 有某 Oversized File 的拒收紀錄（`code: "DRIVE_PATH_ERROR"`、`cli_version` 與執行中不同）時，下一輪 `uploadFile` 呼叫 0 次、回報 `FILE_TOO_LARGE`，且該紀錄被移除。自動化，CI。
8. **Repository checks**：`npm run typecheck`、`npm test`、`npm run build` 通過。CI。
9. **Live 驗收（post-release，非 merge gate）**：前置條件為 CLI 發佈、sadcoderlabs/wspc-drive#92 已 merge，且 WSPC Drive 內附的 `@wspc/cli` 已升到含本變更的版本並安裝。在 `~/.hermes/profiles/pocketshark/library` 以 `mkfile -n 101m tmp-oversized-check.bin` 建立 sparse 檔：`.wspc-drive/debug.log` 出現該 path 的 `error` event（`op: "file_too_large"`、`code: "FILE_TOO_LARGE"`），沒有該 path 的 `op: "process"` 事件；WSPC Drive dashboard 顯示「檔案太大」白話訊息而非 `DRIVE_PATH_ERROR: HTTP 413`（截圖）。刪除該檔後下一輪 `sync_end` 的 `errors` 為 0。手動，結果回報在實作 Todo comment。

## Implementation Decisions

### 取捨順序與決策權

取捨順序：

1. Event contract 與 `state.json` 相容性 > 錯誤訊息措辭。WSPC Drive 依 `path_errors` 的 `code`／`message` 顯示狀態，改 shape 會讓 app 失效。
2. 不上傳注定被拒的檔案 > 與 server 上限自動同步。這是寫死 100 MiB 的理由；server 日後調整上限時，須同步發佈 CLI。
3. 最小改動 > 抽象化。上限只有一個數值、一個 caller。

判斷準則：

- 「Oversized File」只看本輪 scan 的 `size_bytes`，不看 remote 的 `size_bytes`。例：本機 `104857601` bytes → 是；本機 `104857600` bytes → 不是。
- 「決策為 upload」指 `decideDriveAction()` 回傳 `upload_create` 或 `upload_update`。反例：`conflict` 不算。

實作者自行決定：

- 常數名稱與放置位置（建議 `sync.ts` export `DRIVE_MAX_FILE_SIZE_BYTES`，旁註 server 來源 `packages/drive/worker/src/limits.ts`）。
- 測試 helper 的命名與拆分。
- Oversized File 判定要不要與 Permanent Upload Rejection 的略過集合共用同一個 `Set`。

決定後回報（寫在實作 PR）：

- 若 sparse file 在 CI 的 hash 時間讓單一測試超過 5 秒，改用的替代做法。
- `debug.log` event 欄位若需要超出 `path`、`op`、`code`、`message` 的內容。

停下來詢問：

- 需要改變 `path_errors` shape、新增 `state.json` 欄位，或變更 `retryable` 語意。
- 需要 server 改動（例如讀取 server 公開的上限）。
- 需要在 conflict 流程加入大小預檢。
- `mkfile`／sparse file 無法在 live 驗收環境建立。

### 實作地圖

| 檔案 | 變更 |
| --- | --- |
| `src/handwritten/commands/drive/retry.ts` | `driveHttpError()`：status 413 且 `errorCode(payload)` 為 `undefined` 時，`code` 設為 `"FILE_TOO_LARGE"`。 |
| `src/handwritten/commands/drive/sync.ts` | 新增上限常數；在既有 Permanent Upload Rejection 迴圈**之前**、`pendingPaths` 計算之前，對每個 `paths` 中、不在 `movedPaths` 的 path 判定 Oversized File；符合者以 `recordDrivePathError(summary, undefined, path, undefined, { appendPathResult: true, debug, op: "file_too_large", pathError })` 回報，並排除於 `pendingPaths`。 |
| `test/handwritten/drive/retry.test.ts` | AC 6 的 `driveHttpError()` 單元測試（以 `new Response(..., { status: 413 })` 建立）。 |
| `test/handwritten/drive/sync.test.ts` | AC 1–7；沿用 `mkApi()`、`rejectUploadsOf()`、`uploadCount()`、`entry()`、`stateEntry()`。AC 3 的 100 MiB 上傳需自訂 `uploadFile`，避免 `mkApi()` 將 body 轉成字串。 |
| `CONTEXT.md` | 已新增 **Oversized File** 詞彙（本 spec PR）。 |

不要動：

- `src/generated/`（codegen 產物）。
- `path-executor.ts` 的上傳流程與 conflict 流程。
- `state.ts` 的 schema 與 validator。
- `watch.ts`。

允許的附帶變更：型別調整、既有測試 helper 的小幅擴充。

### 已查證事實與已知陷阱

已查證事實：

- Server 單檔上限：`sadcoderlabs/wspc` `origin/main` `eb439ca7`，`packages/drive/worker/src/limits.ts:2` `MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024`；`packages/drive/worker/src/services/files-service.ts:181` `if (sizeBytes > MAX_FILE_SIZE_BYTES) throw new DriveFileTooLargeError()`（`>`，所以剛好 100 MiB 允許）。
- Server 錯誤：`packages/drive/worker/src/errors.ts:47` `FILE_TOO_LARGE: 413`。
- 本 repo `spec/openapi.json`：`drive_file_upload` 的 responses 為 `200、400、401、403、404、409、429、500、503`，沒有 413；`DriveLibrary` schema 沒有上限欄位；沒有 multipart／resumable upload operation。
- `drivePathErrorSummary()`（`src/handwritten/commands/drive/path-executor.ts`）以 error 的 `code` 為 path error `code`，缺 `code` 時為 `DRIVE_PATH_ERROR`；`retryable` 在沒有 structured `retryable` 且 `code` 不是 `ENOENT`／`EPERM`／`EBUSY` 時為 `false`。
- `isPermanentUploadRejection()` 已把 413 視為永久拒收；`runDriveSyncOnce()` 的拒收迴圈位於 `applyRenamesAsMoves()` 之後、`pendingPaths` 之前。
- Scan 的 `size_bytes` 來自 `stat`／hash（`scanner.ts`），full 與 incremental scan 都涵蓋完整本機 view。
- Sparse file：macOS 以 `fs.truncateSync(path, 104857601)` 建立的檔案 `blocks: 0`，串流 sha256 約 91 ms（2026-09-18 本機量測）。CI 僅 `ubuntu-latest`（`.github/workflows/pr.yml:10`）。
- WSPC Drive 內附 CLI 為 exact pin（`package.json` `"@wspc/cli": "0.13.0"`），升級需另開 wspc-drive PR 與 app release。

已知陷阱：

- 症狀：AC 3 測試記憶體暴增或逾時。原因：`mkApi().uploadFile` 會把 body 轉成 UTF-8 字串。處理：該測試自訂 `uploadFile`，只記錄 `byteLength` 與 digest。
- 症狀：同一 path 回報兩筆 path error 或 `errors === 2`。原因：Oversized File 與拒收紀錄都命中。處理：Oversized File 判定放在拒收迴圈之前，並讓拒收迴圈略過已回報的 path；`recordDrivePathError()` 本身也會依 path 去重。
- 症狀：改名的大檔被 `applyRenamesAsMoves()` 以 move 處理。說明：move 不上傳內容，屬預期行為；判定只作用在 `movedPaths` 以外的 path。

實作前讀回：

- `spec/openapi.json` 的 `drive_file_upload` responses 與 `DriveLibrary` schema。若已出現 413 描述或上限欄位，停下來詢問是否改讀 server 上限。

### 後續方向

Server 若公開單檔上限（例如 library 回應帶 `max_file_size_bytes`），CLI 改讀該值取代常數。讓超過 100 MiB 的檔案可以同步需要 server 產品決策與新的上傳 API，須先在 `sadcoderlabs/wspc` 另立 spec。

## Testing Decisions

| AC | 驗證 |
| --- | --- |
| 1、2、3、4、5、7 | `test/handwritten/drive/sync.test.ts`：暫存 library、sparse file、fake `DriveSyncApi`，多輪 `runDriveSyncOnce()`，斷言 `uploadFile` 呼叫次數、summary、`onProgress` 與 `state.json`。 |
| 6 | `test/handwritten/drive/retry.test.ts` 的 `driveHttpError()` 單元測試；`sync.test.ts` 以 `rejectUploadsOf(api, path, () => driveHttpError(new Response("", { status: 413 })))` 驗證 summary 與 `upload_rejections`。 |
| 8 | CI 既有 typecheck、test、build job。 |
| 9 | Post-release 手動；需要 app 內附新版 CLI、#92 的 dashboard 文案與真實 edge 行為，CI 無法重現。不阻擋 merge。 |

實作切片（依序；每片先寫失敗測試並確認失敗原因）：

1. **413 對應**：先寫 `retry.test.ts` 的 413 無 `code` 測試，預期失敗為 `expected undefined to be 'FILE_TOO_LARGE'`。完成條件：AC 6 單元測試與 sync 層斷言通過。
2. **不讀不傳**：先寫 AC 1 測試，預期失敗為 `uploadFile` 被呼叫 1 次或 path error `code` 為 `FILE_TOO_LARGE`／`message` 為 `HTTP 413`。完成條件：AC 1、2 通過。
3. **邊界與長大**：先寫 AC 3、AC 4 測試；AC 3 應在切片 2 後已通過（作為邊界守護，以把判定改成 `>=` 的 mutation 確認會變紅），AC 4 先失敗於 `uploadFile` 被呼叫。完成條件：AC 3、4 通過。
4. **恢復與舊紀錄**：先寫 AC 5、AC 7 測試；以移除判定或調換判定順序的 mutation 確認會變紅。完成條件：AC 5、7 通過，`npm run typecheck`、`npm test`、`npm run build` 通過。

## Out of Scope

- 讓超過 100 MiB 的檔案可以同步（chunked／resumable upload、提高 server 上限）：需要 server 產品決策（上限、storage quota、定價）與新 API；有使用者明確需要同步大檔時，先在 `sadcoderlabs/wspc` 另立 spec。
- Server 公開單檔上限的 API：列為後續方向；server 調整上限或提供該欄位時再開。
- Scanner 在大檔變動時計算 sha256 的本機 CPU 成本：不涉及網路或上傳；有效能證據時再開。
- Conflict 流程（remote 同時變動）的大小預檢：只靠 HTTP 413 對應拿到 `FILE_TOO_LARGE`；出現實際案例時再開。
- WSPC Drive app 的文案與 CLI 升級：由 sadcoderlabs/wspc-drive#92 與後續的 CLI bump PR 處理。

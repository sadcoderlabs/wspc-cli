# WSPC CLI Drive 首次同步 recovery 實作計畫

> **給實作者：** 依序執行，每個行為先寫 failing test、確認 RED，再做最小實作。本計畫以固定 canonical spec revision 驗收，不跟隨 `main` 後續漂移。

**Canonical spec current URL：** `https://github.com/sadcoderlabs/wspc-drive/blob/main/docs/superpowers/specs/2026-07-23-drive-first-sync-recovery-design.md`

**Canonical spec pinned URL：** `https://github.com/sadcoderlabs/wspc-drive/blob/591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3/docs/superpowers/specs/2026-07-23-drive-first-sync-recovery-design.md`

**Spec revision：** `591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3`

**Related WSPC Drive todo：** `tod_01KY68HME8SGE09RP03QPP6HVM`

**目標：** 讓 `wspc drive watch` 在第一次大量同步遇到 HTTP 429 或 transient remote failure 時立即停止該輪、遵守 `Retry-After` 後自動 full retry；同時把不支援的本機路徑持久化並在每輪 machine-readable summary 中穩定輸出。

**架構：** 新的 internal retry-policy module 擁有 typed HTTP error、`Retry-After` 解析與 retry classification。API adapter 產生 typed error，sync engine 決定 retryable failure 要中斷或 permanent path failure 要記錄，watch scheduler 只消費 retry decision。Scanner error ledger 是 `DriveState` schema v1 的 optional extension，與 `scan_cache` 一起 checkpoint。既有 realtime pending-state coalescing 不重作。

**技術棧：** TypeScript、Node fetch / fs、Luxon、Commander、Vitest。

---

## 前置條件

- [ ] Canonical spec docs-only PR 已合併。
- [ ] 確認 pinned URL 可直接開啟，且 implementation scope 與 revision `591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3` 一致。
- [ ] `git merge-base HEAD origin/main` 包含 commit `a3bd676235f256920d9bb4a808cdfc548a6c8b2f`；這代表 realtime cursor write 已會在 sync lock 釋放後重試。

## 任務 1：建立 typed remote failure 與 retry policy module

**檔案：**

- 新增：`src/handwritten/commands/drive/retry.ts`
- 新增：`test/handwritten/drive/retry.test.ts`
- 修改：`src/handwritten/commands/drive/api.ts`
- 修改：`test/handwritten/drive/api.test.ts`

- [ ] **步驟 1：寫 RED retry-policy tests**

先鎖定 module 的 observable interface：

1. `DriveHttpError` 保存 `status`、optional safe `code`、optional `retryAfterMs`，message 只需為 `HTTP <status>` 或同等低敏感摘要。
2. `Retry-After: 60` 解析為 60,000ms。
3. HTTP-date 使用 injected Luxon `DateTime` 計算；未來時間得到正 delay，過去時間得到 0。
4. malformed / negative header 回 `undefined`，交由 fallback policy。
5. 429 分類為 `rate_limited`；5xx 與標準 network/fetch failure 分類為 `transient`；401 / 403 與一般 4xx 不 retry。
6. 合法 explicit delay 即使超過 60 秒也完整保留；只有 fallback exponential delay cap 在 60,000ms。
7. 舊 fake error 只有 `status` 或 message 時仍可 fallback 分類，但 typed error path 不依賴 regex。

執行：

```bash
npm test -- test/handwritten/drive/retry.test.ts
```

預期：module 尚不存在而失敗。

- [ ] **步驟 2：實作最小 deep module**

讓 `retry.ts` 對外只提供 sync / watch 真正需要的窄介面，例如：

```ts
export class DriveHttpError extends Error { /* structured fields */ }
export function parseRetryAfter(value: string | undefined, now: DateTime): number | undefined
export function classifyDriveRetry(error: unknown, fallbackMs: number, now: DateTime): DriveRetryDecision | undefined
export function isRetryableDriveFailure(error: unknown): boolean
```

不要把 SDK `JsonResult` type 搬進 policy module；`api.ts` 是 SDK/raw fetch adapter，負責抽出 response status、header 與 safe error code後建構 `DriveHttpError`。

- [ ] **步驟 3：寫 RED API adapter tests**

擴充 `api.test.ts`：SDK-based manifest/delete/move failure 與 raw upload/download failure 都應 reject `DriveHttpError`。至少一個 case 驗證 response body 有 token-like 內容時，typed error message 不包含 body；另一個 case 驗證 `Retry-After` 被保存。

- [ ] **步驟 4：替換 plain Error adapter**

修改 `asError()`、`expectJsonResult()` 與 raw content response branches，所有 HTTP non-2xx 統一產生 `DriveHttpError`。如果 SDK error body 有穩定 string `code` 才保存；不猜測 arbitrary nested payload。

- [ ] **步驟 5：確認 focused GREEN**

```bash
npm test -- test/handwritten/drive/retry.test.ts test/handwritten/drive/api.test.ts
```

## 任務 2：讓第一個 retryable failure 中斷 sync round

**檔案：**

- 修改：`src/handwritten/commands/drive/sync.ts`
- 修改：`test/handwritten/drive/sync.test.ts`
- 修改：`src/handwritten/commands/drive/retry.ts`
- 修改：`test/handwritten/drive/retry.test.ts`

- [ ] **步驟 1：寫 RED durable-progress regression test**

用 5 個待 upload 檔案與可記錄 call order 的 fake API：前 2 個成功，第 3 個丟 `DriveHttpError(429)`，斷言：

- `runDriveSyncOnce()` rejects retryable sync interruption，而不是 resolve `{ errors: 1 }`。
- 第 4、5 個沒有收到 upload call。
- 前 2 個成功檔案已存在於重新讀取的 state。
- interruption context 的 `remaining` 包含第 3 個與後續檔案。
- 再跑一次 full sync 時只完成剩餘 mutation，最終 clean summary，前 2 個不重傳。

再補 manifest 429 與 move optimization 429 cases：manifest failure 直接冒出且 remaining 可省略；move 的 retryable failure 不可降級成 upload + delete。一般 permanent move failure仍保留既有 optimization fallback。

執行：

```bash
npm test -- test/handwritten/drive/sync.test.ts
```

預期：目前 per-path catch 把 429 記成 error 並繼續，所以 assertions 失敗。

- [ ] **步驟 2：加入 sync interruption context**

在 retry module 或 sync module 定義 typed `DriveRetryableSyncError`，保存 original cause、optional remaining 與本輪已知 `pathErrors`。不要把 partial uploaded/downloaded counters當成跨輪累計 contract；Drive UI 只需要 remaining 與永久 path errors。

`processPath()`、move optimization 與其他會 catch remote failure 的 boundary，在進入 version conflict/permanent error fallback 前先呼叫 typed classifier；retryable 就 rethrow。最外層 sync round 在已知 total/processed 時附上 `remaining = total - processed`。Manifest 等 pre-plan failure 不捏造 remaining。

維持既有 durable write 順序。不要為了 retry 引入 batch transaction或 rollback 已成功的 remote mutation。

- [ ] **步驟 3：鎖定 `sync once` 語意**

Command test 驗證 retryable interruption 使 `wspc drive sync once` 非零結束，且不在 command 內 sleep/retry。`watch` 才是長跑 scheduler。

- [ ] **步驟 4：確認 focused GREEN**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/retry.test.ts
```

## 任務 3：持久化 scanner error ledger

**檔案：**

- 修改：`src/handwritten/commands/drive/path-policy.ts`
- 修改：`test/handwritten/drive/path-policy.test.ts`
- 修改：`src/handwritten/commands/drive/state.ts`
- 修改：`test/handwritten/drive/state.test.ts`
- 修改：`src/handwritten/commands/drive/scanner.ts`
- 修改：`test/handwritten/drive/scanner.test.ts`
- 修改：`src/handwritten/commands/drive/sync.ts`
- 修改：`test/handwritten/drive/sync.test.ts`

- [ ] **步驟 1：寫 RED stable path-code tests**

讓 `validateDrivePath()` 對 control character、empty segment、byte limit 等既有 failures 都丟出可辨認為 `INVALID_DRIVE_PATH` 的 typed error，同時保留目前 human-readable message assertions。Consumer 不應解析 message 取得 code。

- [ ] **步驟 2：寫 RED state schema tests**

驗證 `schema_version: 1` 可 round-trip optional：

```json
{
  "scan_errors": {
    "bad\nname.md": {
      "code": "INVALID_DRIVE_PATH",
      "message": "invalid drive path: control character",
      "retryable": false
    }
  }
}
```

State validator 必須接受 ledger key 內的控制字元，但拒絕 malformed item、unknown unsafe value types。`initDriveState()` 不必寫空 map；optional absence 代表空 ledger。

- [ ] **步驟 3：寫 RED full/incremental reconciliation tests**

在真實 temp directory 建立檔名含換行的檔案，驗證：

1. Full sync 寫入 `scan_errors`，summary `errors: 1` 且 `path_errors` 有 stable code/message/retryable。
2. 下一輪只 dirty 一個無關合法檔案，原 invalid path 仍存在於 state 與 summary，不會假裝 errors 0。
3. Invalid path rename 成合法 path 後，old-path unlink/new-path add 的 incremental reconciliation 清除 ledger並上傳新檔。
4. Invalid path被移除或 dirty parent full-rescan 後，ledger 清除。
5. 同一路徑同一輪只計數/輸出一次，`path_errors` 依 path 排序。

- [ ] **步驟 4：實作 ledger reconcile**

Full scan 從空 map 收集 errors。Incremental scan 從 `state.scan_errors` 複製，先依 dirty path relationship 移除待重驗項目，再把 scanner callback 的新 errors 寫入。不能拿 invalid key 呼叫 `resolveInsideRoot()` 或遠端 API。

把 `scan_cache` 與 `scan_errors` 組成同一個 next state 後只做一次必要的 `writeDriveState()` checkpoint。`cloneDriveState()` 必須深複製 ledger map，避免跨 state mutation。

`DriveSyncSummary` 新增 `path_errors`。Persistent ledger 每輪都進 summary 與 `errors`，即使 scanner 因 incremental cache 沒走到該路徑。既有 `paths[].action` 保留，但不得作為新 consumer contract。

- [ ] **步驟 5：確認 focused GREEN**

```bash
npm test -- test/handwritten/drive/path-policy.test.ts test/handwritten/drive/state.test.ts test/handwritten/drive/scanner.test.ts test/handwritten/drive/sync.test.ts
```

## 任務 4：讓 watch scheduler 遵守 Retry-After 並輸出 recovery contract

**檔案：**

- 修改：`src/handwritten/commands/drive/watch.ts`
- 修改：`test/handwritten/drive/watch.test.ts`
- 修改：`src/handwritten/commands/drive/retry.ts`
- 修改：`test/handwritten/drive/retry.test.ts`

- [ ] **步驟 1：寫 RED scheduler tests**

以 injected clock 與 cancellable sleep/timer adapter 驗證：

1. 429 + `Retry-After: 60` 發出 `{ kind: "drive_watch_retry", reason: "rate_limited", delay_ms: 60000, remaining, error: "HTTP 429", path_errors }`，等待 60 秒後 full retry。
2. `Retry-After` 為 120 秒時等待 120 秒，不被 fallback cap 截成 60 秒。
3. Header 缺少時 fallback 依序為 1s、2s、4s，並在 60s cap；成功 round 後 reset 1s。
4. 連續至少 4 次 retryable failure 都繼續，證明沒有 attempt cap；test 不使用真實 sleep。
5. 401 / 403、unsupported state、active lock 與 permanent error 仍終止。
6. retry trigger 傳 `dirtyPaths === undefined`，強制 full reconciliation。
7. 混合 persistent path error + 429 的 retry event 帶 `path_errors`；下一輪只剩 permanent paths 時 emit `drive_sync_once` errors > 0，而不是繼續 retry。

執行：

```bash
npm test -- test/handwritten/drive/watch.test.ts
```

預期：目前 scheduler 使用 message regex、固定 exponential delay與 global `setTimeout`，所以新 cases 失敗或無法無等待測試。

- [ ] **步驟 2：注入 scheduler seam**

把 production timer 包成一個可 cancel 的 internal adapter；`DriveWatchOptions` 只 expose tests 需要的 optional seam，不新增 CLI flags。Stop signal / process cleanup 必須 cancel pending wait，保持目前 watch shutdown 行為。

Clock 使用現有 `DriveClock` 或一個窄 DateTime provider。不得以修改全域 clock 或 monkey-patch production `Date.now()` 完成單元測試。

- [ ] **步驟 3：由 typed decision 排程**

Catch `DriveRetryableSyncError` 後呼叫 `classifyDriveRetry()`：explicit `retryAfterMs` 優先，缺少才使用目前 fallback。Event `error` 只輸出 safe摘要。Debug log 可含 status/code/reason/delay/remaining，但不可寫 raw response body或 auth資料。

每次 retry 前設定 `nextTrigger = "retry"`，沿用 full scan correctness path。Watch process 還在就不設 attempt cap。

- [ ] **步驟 4：確認 focused GREEN**

```bash
npm test -- test/handwritten/drive/watch.test.ts test/handwritten/drive/retry.test.ts test/handwritten/drive/sync.test.ts
```

## 任務 5：更新本地 docs 與 machine-readable contract說明

**檔案：**

- 修改：`docs/superpowers/specs/2026-06-21-drive-sync-watch-design.md`
- 修改：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 視需要修改：`README.md`

- [ ] **步驟 1：連回 pinned canonical spec**

在既有 watch failure handling 與 state schema 章節加入 pinned canonical URL / revision。不要複製 canonical spec 全文；只更新已被新 contract 取代的本 repo 說明。

- [ ] **步驟 2：記錄 additive event fields**

在 CLI docs 列出 `drive_watch_retry` 的 `reason` / `delay_ms` / optional `remaining` / optional `path_errors`，以及 `drive_sync_once.path_errors`。說明未知 optional fields 可忽略，沒有全域 protocol version。

- [ ] **步驟 3：記錄 schema v1 extension**

說明 `scan_errors` 是 schema v1 optional ledger、invalid key 不可當 remote path、full/incremental reconcile規則。

## 任務 6：完整驗證、低 quota integration 與 release

- [ ] **步驟 1：跑完整 repository checks**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

預期全部以 0 結束。

- [ ] **步驟 2：低 quota integration**

在 local 或 staging 把獨立測試帳號的 Drive write limit 設為 3 writes / 2 seconds，用 10 個以上檔案跑 `wspc drive watch --json`。驗證：

- 第一個 429 後該輪停止，等待 header 指定時間；
- 後續自動 full retry，沒有人工重啟；
- NDJSON event符合 canonical fixture；
- 最終有效檔案全數收斂；
- invalid path 仍在每輪 `path_errors`，改名後清除。

- [ ] **步驟 3：準備 release handoff**

CLI PR body 記錄 `Spec revision: 591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3`，並 cross-link WSPC Drive consumer PR / todo。發佈精確 package version後，把 version 與 producer fixture commit交給 Drive plan；Drive 不可在 CLI package 發佈前先依賴 GitHub branch tarball。

## 任務 7：Production synthetic canary handoff

CLI 發布、Drive bump 並發版後，與 Drive plan 共用一個獨立 500+ file synthetic library 做 production canary。不得使用真實使用者的 `library`。記錄每輪 retry delay、429 request數、最後 local/state/manifest counts與 rollback version；canary完成後刪除 synthetic library。

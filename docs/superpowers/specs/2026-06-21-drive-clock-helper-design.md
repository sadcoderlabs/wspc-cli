# Drive Clock Helper Design

## 來源

這份 spec 對應 WSPC todo `tod_01KVNAS7C1VHJSQF6D5RCE3R58`：`Refactor Drive timestamp creation behind a tiny clock helper`。

使用者補充要求：Drive 的時間日期相關操作應該使用 Luxon 處理。

## 目標

這個 refactor 要把 Drive sync 內散落的「目前時間」與 timestamp 格式化集中到一個很小的 Drive clock helper。完成後，`src/handwritten/commands/drive/state.ts`、`sync.ts`、`merge.ts`、`realtime.ts` 不應再各自用 `new Date().toISOString()` 產生 Drive state 或 conflict metadata timestamp。

Drive state 仍保存既有字串格式，不改 `.wspc-drive/state.json` schema。`created_at`、`updated_at`、`last_synced_at`、`detected_at`、`last_connected_at`、`last_event_at` 仍是 ISO 8601 字串，並保留 `Z` 或 offset。Conflict copy 檔名仍使用目前的 UTC second-precision 格式，例如 `20260621T101000Z`，避免破壞既有測試與使用者可讀性。

## 目前狀態

`DEVELOPER.md` 已規定時間 / 日期 / 時區處理使用 Luxon `DateTime`，`Date.now()` 取 Unix ms 合法。Drive state validation 已經在 `state.ts` 使用 `DateTime.fromISO(value, { setZone: true })` 驗證 realtime timestamp，但產生 timestamp 的地方仍混用 `new Date().toISOString()`。

目前主要散落點：

- `state.ts` 的 `writeDriveState()` 與 `initDriveState()` 產生 `updated_at`、`created_at`。
- `sync.ts` 的 conflict recording、state entry creation、conflict copy path creation 使用 `new Date()` 或 `new Date().toISOString()`。
- `merge.ts` 的 `conflictCopyPath()` 接收 `Date` 並自行做 filename timestamp 格式化。
- `realtime.ts` 的 realtime metadata 接收 `now?: () => Date`，再用 `toISOString()` 寫入 `last_connected_at` / `last_event_at`。

`watch.ts` 的 `Date.now()` 用於 deadline / timer loop，這是系統 timestamp / scheduling 用途，不在本次 refactor 範圍內。

## 設計

新增一個 Drive 內部 helper，例如 `src/handwritten/commands/drive/clock.ts`。它只負責 Drive 模組需要的兩種輸出：

- state / metadata 用 ISO timestamp。
- conflict copy filename 用 UTC compact timestamp。

建議 API 保持很小：

```ts
import { DateTime } from "luxon"

export interface DriveClock {
  now(): DateTime
}

export const systemDriveClock: DriveClock = {
  now: () => DateTime.utc(),
}

export function driveIsoTimestamp(clock: DriveClock = systemDriveClock): string
export function driveConflictTimestamp(clock: DriveClock = systemDriveClock): string
```

`driveIsoTimestamp()` 應回傳可被 `DateTime.fromISO(value, { setZone: true })` 接受的 ISO 字串。預設使用 UTC，讓本機 state metadata 不受使用者環境 timezone 影響。

`driveConflictTimestamp()` 應回傳 `yyyyLLdd'T'HHmmss'Z'` 格式，從 `clock.now().toUTC()` 格式化而來。這取代目前在 `merge.ts` 以 `Date#toISOString()` 再手動 replace 的流程。

這個 helper 不需要 class，不需要 dependency injection framework，也不需要全 repo clock abstraction。Drive module 需要可測試時間時，傳入 `{ now: () => DateTime.fromISO("2026-06-21T10:10:00Z", { setZone: true }) }` 即可。

## 修改範圍

包含：

- 新增 `src/handwritten/commands/drive/clock.ts`。
- `state.ts` 使用 `driveIsoTimestamp()` 產生 `created_at` / `updated_at`。
- `sync.ts` 使用 `driveIsoTimestamp()` 產生 `last_synced_at` / `detected_at`。
- `sync.ts` 呼叫 conflict copy path 時傳入 clock 或已格式化 timestamp，而不是直接 `new Date()`。
- `merge.ts` 的 `conflictCopyPath()` 改成接收 compact timestamp 或 `DriveClock`，以 Luxon helper 產生檔名 timestamp。
- `realtime.ts` 的 `now?: () => Date` 改成 `clock?: DriveClock` 或 `now?: () => DateTime`，並用 `driveIsoTimestamp()` 寫入 realtime metadata。
- 更新 Drive 相關測試，移除需要 fake system time 的 cases，改用固定 clock。

不包含：

- 不改 `.wspc-drive/state.json` schema version。
- 不改 timestamp 欄位名稱或語意。
- 不改 remote manifest 的 `updated_at`，那是 API 回傳資料，不由 CLI 產生。
- 不改 `watch.ts` 的 `Date.now()` deadline/backoff 計算。
- 不把這次改動擴成全 repo clock helper。
- 不新增 dependency；Luxon 已是現有 dependency。

## 行為相容性

既有 state 檔仍可讀。Validation 仍接受 ISO 8601 + zone 的字串，不需要 migration。

Conflict copy 檔名格式應維持目前 regex 可接受的形狀：

```text
notes.remote-conflict-20260621T101000Z-ver_2.md
```

如果某些舊測試透過 `vi.setSystemTime()` 固定 conflict copy 檔名，實作時應改成注入 fixed `DriveClock`。這是測試穩定性的改進，不是行為變更。

## Grill-me 設計檢查

目標與成功標準清楚：集中 Drive timestamp creation，符合 Luxon convention，保持 state schema 與檔名相容。

範圍邊界清楚：只碰 Drive 產生 timestamp 的地方，不碰 scheduling `Date.now()`，不新增全 repo abstraction。

資料所有權清楚：Drive clock helper 只產生 CLI 本地 state metadata；API 回傳的 remote timestamp 不重寫。

失敗模式低風險：helper 若產生 invalid ISO，既有 state validation 和 focused tests 會失敗。沒有資料 migration，也沒有網路或 auth 行為變更。

結論：ready。這是可直接實作的小 refactor。

## 測試

最小 TDD 流程：

1. 新增 `test/handwritten/drive/clock.test.ts`，先證明 `driveIsoTimestamp()` 與 `driveConflictTimestamp()` 使用 fixed Luxon `DateTime` 產生預期字串。
2. 更新 `state.test.ts`，確認 `initDriveState()` / `writeDriveState()` 可用 fixed clock 產生穩定 `created_at` / `updated_at`。
3. 更新 `sync.test.ts` 與 `merge.test.ts` 的 conflict copy timestamp 測試，改用 fixed clock，不再依賴 `vi.setSystemTime()`。
4. 更新 `realtime.test.ts`，讓 realtime metadata timestamp 用 fixed Luxon clock。

驗證指令：

```bash
npm test -- test/handwritten/drive/clock.test.ts test/handwritten/drive/state.test.ts test/handwritten/drive/sync.test.ts test/handwritten/drive/merge.test.ts test/handwritten/drive/realtime.test.ts
npm run typecheck
git diff --check
```

若實作只改 Drive helper 與 Drive tests，不需要跑 OpenAPI generate pipeline。

## 接受標準

- Drive 產生 state / metadata timestamp 的程式碼使用 Luxon `DateTime`，不再直接呼叫 `new Date().toISOString()`。
- Conflict copy filename timestamp 由 Luxon helper 產生，格式保持 `yyyyLLdd'T'HHmmss'Z'`。
- `Date.now()` 只保留在 deadline、timer、backoff 或 temp-name uniqueness 等系統 timestamp 用途。
- Drive tests 不再需要為 conflict copy timestamp 使用 fake system time；固定 clock 可直接注入。
- `.wspc-drive/state.json` schema 不變，既有 state fixture 繼續可讀。

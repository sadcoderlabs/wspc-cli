# Timezone-safe Date Output 設計

## 目標

修正 pretty output 把 Calendar Date 當成 Instant 計算 Relative Time 的問題。Todo `due_at` 與 all-day event `start`／`end` 使用 ISO date-only；它們應原樣顯示 `YYYY-MM-DD`，不得因執行 CLI 的時區或時間而改變。

真正的 Instant 繼續顯示既有 Relative Time。`--json`、raw output、欄位排序與 generated display metadata 都不改變。

對應 Todo：`tod_01KYGG30ADVFNKQ61G0SF46QVF`

## Domain contract

本設計使用 root [`CONTEXT.md`](../../../CONTEXT.md) 的術語：

- **Calendar Date** 是沒有時間與時區的 ISO date-only，不是午夜 Instant。
- **Instant** 只接受 Unix ms，或帶 `Z`／offset、能唯一指向時間軸位置的 ISO datetime。
- **Relative Time** 是 Instant 相對於目前時間的 elapsed duration，不是日曆距離。
- All-day event 的 `end` 是 API 的 **Exclusive End**。

Pretty output contract：

```text
due_at:    2026-07-28
created_at: 2h ago
```

Calendar Date 一律保留 raw ISO date。不要顯示 `today`、`tomorrow`、`in 1d` 或 `1d ago`，也不要為它選擇顯示時區。

## 現況與 root cause

`src/handwritten/output/primitives.ts` 的 `relativeTime()` 目前用 `Date.parse()` 解析所有 string。JavaScript 會把 `YYYY-MM-DD` 解讀成 UTC 午夜，因此 Calendar Date 會先被錯誤轉成 Instant，再與 `Date.now()` 做 millisecond threshold 計算。

同一 formatter 也處理真正的 ISO datetime 與 Unix ms。修正應落在這個 shared boundary，讓所有經過 `relative-time` display hint 的 Todo 與 event caller 一次得到正確行為。

## 設計

保留既有 `relativeTime(value, now)` public shape 與 `relative-time` formatter id，不新增 `calendar-date` formatter，也不修改 OpenAPI metadata 或 generated files。

`relativeTime()` 依值的 representation 分流：

1. 合法 `YYYY-MM-DD` 直接回傳原字串。
2. Unix ms 用 Luxon `DateTime.fromMillis()` 建立 Instant。
3. 帶 `Z`／offset 的 ISO datetime 用 Luxon `DateTime.fromISO(value, { setZone: true })` 建立 Instant。
4. Offsetless datetime、無效 ISO、無效數字與其他型別維持現有安全 fallback，回傳原值的 string representation。

不要從 system timezone、`WSPC_TZ` 或 command `--tz` 推測 offsetless datetime 的時區。那些設定用於解析使用者輸入，不是修補 API output 中不完整的 Instant。

Calendar Date 可在 `primitives.ts` 內用現有 API contract 的 strict `YYYY-MM-DD` shape 辨識；不新增 shared temporal abstraction、formatter registry layer 或 dependency。Luxon 已是 production dependency。

## Relative Time 相容性

Instant 的輸出必須保持既有 elapsed-duration semantics：

- 少於一分鐘：`just now`
- 分鐘、時、日、週：維持目前 thresholds 與 `Math.round()` 行為
- 月：維持目前 30-day threshold
- 過去使用 `<amount><unit> ago`
- 未來使用 `in <amount><unit>`

Luxon 負責 Instant 的 parsing 與時間差計算，但這次不改成 calendar-aware `diff(["days"])`，也不讓 DST 邊界把實際 23 小時改顯示成 `1d`。

## All-day event 邊界

Pretty output 保留 API payload 的 raw Exclusive End：

```text
start: 2026-06-01
end:   2026-06-02
```

這次不把 Exclusive End 轉回 command input 使用的 inclusive end，不新增 event-specific renderer，也不讓 pretty output 與 JSON payload 暗中使用不同邊界。若未來需要 inclusive display，另開 Todo 定義欄位名稱與 round-trip UX。

## 範圍

包含：

- 修改 `src/handwritten/output/primitives.ts`。
- 在 output primitive tests 覆蓋 Calendar Date、Instant、DST 與 invalid fallback。
- 在 generic output renderer tests 覆蓋 Todo `due_at` 與 all-day event boundaries。

不包含：

- 不修改 `src/generated/`。
- 不修改 OpenAPI display metadata。
- 不新增 formatter id 或 output type。
- 不新增 timezone flag、global display timezone 或 config。
- 不改 `parseTimeInput()`、`parseDateOnly()` 或 event input conversion。
- 不改 JSON／raw output。
- 不重新設計 Relative Time thresholds 或文字。

## TDD 與測試案例

先在 `test/output-primitives.test.ts` 寫失敗測試並確認現況失敗：

- `2026-07-28` 在 UTC／local day boundary 附近仍輸出 `2026-07-28`。
- 帶 `Z` 與 offset 的 ISO datetime 維持既有 Relative Time。
- Offsetless datetime 原樣 fallback。
- 無效日期與無效 input 原樣 fallback。
- DST 前後相差 23 小時的 Instant 顯示 `23h`，不顯示 `1d`。

再在 `test/output-render.test.ts` 經由 generic renderer 驗證：

- Todo `due_at` 顯示 raw Calendar Date，`created_at` 仍顯示 Relative Time。
- All-day event `start` 與 Exclusive End 都顯示 raw Calendar Date。
- 相同 payload 經 JSON mode 時內容不變。

最小驗證：

```bash
npm test -- test/output-primitives.test.ts test/output-render.test.ts
npm run typecheck
git diff --check
```

## 接受標準

- Calendar Date 不再經 `Date.parse()` 或任何 timezone conversion。
- 同一 Calendar Date 在不同 system timezone 與不同執行時間得到相同 pretty output。
- Unix ms 與帶 offset 的 ISO datetime 維持既有 Relative Time output。
- Offsetless／invalid datetime 不會被推測成 system-zone Instant。
- All-day event 保留 raw Exclusive End。
- JSON／raw output 與 generated files 沒有變動。
- 沒有新增 formatter、dependency、timezone plumbing 或 event-specific renderer。

## 設計檢查結論

狀態：ready。

已鎖定決策：

- Calendar Date 顯示 raw ISO date。
- Shared `relativeTime()` 依值分流，不新增 formatter。
- All-day `end` 保留 raw Exclusive End。
- Offsetless datetime 視為無效 Instant 並 fallback。
- Relative Time 維持 elapsed-duration semantics。

本次決策皆容易在 output layer 調整，未形成難以逆轉的 architecture，因此不建立 ADR。

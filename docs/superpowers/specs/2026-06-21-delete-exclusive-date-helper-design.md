# Delete Exclusive Date Helper Design

## 目標

刪除 `exclusiveEndToInclusive()` 這個沒有 production caller 的日期 helper，並同步刪除只為它存在的測試案例。保留 `parseDateOnly()` 與 `inclusiveEndToExclusive()`，因為 generated event command 仍需要把 all-day inclusive end date 轉成 API 使用的 exclusive end date。

## 目前複雜度

`src/handwritten/utils/parse-date.ts` 匯出三個 helper，其中 `exclusiveEndToInclusive()` 只被 `test/handwritten/utils.test.ts` 引用。repo 內沒有 command、generator 或 runtime path 使用它。這讓 handwritten utils 看起來支援雙向轉換，但目前 CLI 只需要一個方向。

## 精確刪除

從 `src/handwritten/utils/parse-date.ts` 刪除 `exclusiveEndToInclusive()`。從 `test/handwritten/utils.test.ts` 刪除 import 與 `exclusiveEndToInclusive` describe block。

不新增 replacement helper。未來如果真的有 API exclusive end date 需要顯示成 human inclusive date，再用當時的 caller 加回一行 Luxon 轉換即可。

## 不做的事

不改 `parseDateOnly()` 的 validation 與 error message。不改 `inclusiveEndToExclusive()`。不改 generated event command 或 OpenAPI metadata。

## 測試

最小驗證：

```bash
npm test -- test/handwritten/utils.test.ts test/generated/event.test.ts
npm run typecheck
```

## 接受標準

`rg "exclusiveEndToInclusive"` 不再找到 source 或 test 引用。日期 helper 測試仍涵蓋 `parseDateOnly()` 與 `inclusiveEndToExclusive()`。Generated event tests 仍通過。

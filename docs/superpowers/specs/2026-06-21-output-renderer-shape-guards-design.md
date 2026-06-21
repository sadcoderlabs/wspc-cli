# 輸出 Renderer Shape Guards 設計

## 目標

這個 refactor 要把 `src/handwritten/output/render.ts` 裡重複的 object shape probe 與 `Record<string, unknown>` cast 收斂成少量本地 guard/helper，降低之後修改 generic renderer 時的閱讀與型別風險。

完成後 renderer output 不改變。pretty table、object rows、array sub-list、todo/comment/attendee inline formatting、pagination footer、`--json` 與 raw passthrough 都必須維持現狀。

## 目前味道

`render.ts` 目前在多個分支重複寫：

- `data !== null && typeof data === "object"`。
- `!Array.isArray(value)`。
- `value as Record<string, unknown>`。
- 讀 `id`、`title`、`status`、`content`、`created_at`、`email`、`display_name` 前各自做 inline probe。

這些判斷本身不複雜，但分散在 `renderPaginationFooter()`、`drillDataPath()`、`detectShape()`、`extractItems()`、`renderList()`、`renderObject()`、`formatTodoLike()`、`formatCommentLike()`、`formatAttendeeLike()`。未來改 generic renderer 時，很容易漏掉一個 cast 或讓 array/object 判斷不一致。

## 設計

在 `src/handwritten/output/render.ts` 內新增本地 helper，不新增共用 utility module。

最小 helper 組：

- `isRecord(value): value is Record<string, unknown>`：接受非 null object，拒絕 array。
- `getString(record, key): string | undefined`：只在欄位是 string 時回傳。
- `getNonEmptyString(record, key): string | undefined`：給 `display_name` 這類空字串要當作缺省的欄位使用。
- `getArray(record, key): unknown[] | undefined`：只在欄位是 array 時回傳。

如果 implementation 發現 `getNonEmptyString()` 只用一次，可以不加，直接在 caller 寫一行判斷。這是 readability refactor，不要為了消除每一個 `typeof` 而製造更多 helper。

用這些 helper 替換現有重複 shape probe：

- `renderPaginationFooter()` 先用 `isRecord(data)`。
- `drillDataPath()` 用 `isRecord(data)` 讀 wrapper key。
- `detectShape()` 和 `extractItems()` 用 `isRecord()` 與 `getArray()` 判斷 list wrapper。
- `renderList()` 只在 first item 是 record 時 pick columns；若不是 record，退回 scalar-ish formatting 或現有安全 fallback，不應 throw。
- `renderObject()` 用 `isRecord()` 做 envelope unwrap，arrayFields 用 `getArray()`。
- `formatTodoLike()`、`formatCommentLike()`、`formatAttendeeLike()` 用 helper 讀欄位。

Helper 留在 `render.ts` 私有即可。不要 export，不要放進 `src/handwritten/utils/`，也不要改 `primitives.ts`。

## 範圍

包含：

- 修改 `src/handwritten/output/render.ts`。
- 視需要微調 `test/output-render.test.ts`，只補能防止 refactor 破壞輸出的測試。
- 保留既有 `test/handwritten/render-data-path.test.ts` 與 `test/handwritten/bool-badge.test.ts` coverage。

不包含：

- 不改 renderer registry。
- 不改 `XCliDisplay` 或 output type 定義。
- 不改 generated CLI 或 OpenAPI metadata。
- 不新增 dependency。
- 不新增全域 shape guard module。
- 不改 pretty output 文案、顏色、排序、欄位挑選或 JSON policy。

## 實作提示

先跑既有 renderer tests 作為 baseline。接著只做局部替換，保持函式名稱與控制流大致不變，讓 diff 像清理而不是重寫。

`renderList()` 是唯一要小心的地方：目前直接把 `items[0]` 和每個 item cast 成 record。若 list 內容不是 object，現有行為可能會輸出空表或奇怪值。這次 refactor 不需要重新設計 list scalar UX；只要避免 helper 化後新增 throw。若要更完整處理 scalar list，另開 todo。

`formatTodoLike()`、`formatCommentLike()`、`formatAttendeeLike()` 的 fallback contract 要維持：不符合 shape 時回傳 `null`，讓 caller 繼續試下一個 probe 或 `JSON.stringify(item)`。

## 測試

最小驗證：

```bash
npm test -- test/output-render.test.ts test/handwritten/render-data-path.test.ts test/handwritten/bool-badge.test.ts
npm run typecheck
git diff --check
```

若新增測試，優先補在 `test/output-render.test.ts`：

- 非 object array item 不會讓 list rendering throw。
- todo/comment/attendee array item formatting 仍維持既有輸出。
- missing `dataPath` 仍 fallback 到原 payload。

## 接受標準

- `render.ts` 裡 object shape probe 和 `Record<string, unknown>` cast 明顯減少。
- renderer 對現有測試 payload 的 stdout 完全維持語意等價。
- JSON mode、raw mode、pagination footer 不受影響。
- 沒有新增 dependency，也沒有新增 shared utility layer。
- 沒有把 readability refactor 混成 renderer UX 變更。

## 設計檢查結論

狀態：ready。

已鎖定決策：

- 這是單檔內部 refactor，不是 output framework 重設計。
- helper 應留在 `render.ts` 私有；目前沒有值得抽成全域 module 的重用需求。
- 測試以既有 renderer 行為為主，不新增 snapshot-heavy coverage。

剩餘風險：

- Pretty output 受 ANSI、terminal width 與 wrapping 影響，修改時要用既有 stdout helper 和固定 columns 測試保護。
- 如果 implementation 想順手改善 scalar list UX，應拆成另一個行為性 change。

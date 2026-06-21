# Inline Email MIME Helper Design

## 目標

刪除單一 caller 的 `src/handwritten/utils/mime-from-ext.ts` utility file，將 outbound email attachment 的小型 MIME table 收進 `src/handwritten/commands/email/send.ts`。行為維持不變：已知副檔名回傳目前相同的 `content_type`，未知副檔名仍回退到 `application/octet-stream`。

## 目前複雜度

`mimeFromExt()` 只有 `email/send.ts` 使用，卻獨立成 utility file 和專屬 test file。這不是 shared utility；它只是 email send command 的附件實作細節。多一個檔案與匯出點會讓 utils 目錄看起來比實際需求更通用。

## 精確刪除

刪除 `src/handwritten/utils/mime-from-ext.ts` 與 `test/handwritten/mime-from-ext.test.ts`。在 `email/send.ts` 內保留一個私有 `mimeFromExt()` 或等價短函式，旁邊放既有小表。

既有 MIME 對應保持不變：

| Extension | MIME |
| --- | --- |
| `pdf` | `application/pdf` |
| `png` | `image/png` |
| `jpg`, `jpeg` | `image/jpeg` |
| `gif` | `image/gif` |
| `webp` | `image/webp` |
| `txt` | `text/plain` |
| `csv` | `text/csv` |
| `md` | `text/markdown` |
| `html` | `text/html` |
| `json` | `application/json` |
| `ics` | `text/calendar` |
| `zip` | `application/zip` |

## 不做的事

不新增 `mime-types` 或其他 dependency。不擴大 MIME table。不改 attachment size limits、inbound attachment reference parsing、request body shape 或 error messages。

## 測試

最小驗證：

```bash
npm test -- test/handwritten/email-send.test.ts
npm run typecheck
```

如果 `email-send.test.ts` 目前只驗證 `.txt`，實作時可在同檔補一個小案例覆蓋 unknown extension fallback，取代被刪除的 standalone utility test。

## 接受標準

`src/handwritten/utils/mime-from-ext.ts` 與它的 test 不再存在。`email/send.ts` 仍對 attachment file 設定相同 `content_type`。沒有新增 dependency，沒有新增 shared utility。

# CLI SDK Result Helper Refactor Design

> **2026-08-25 contract supersession：**[`Email Attachment Detail contract`](https://github.com/sadcoderlabs/wspc/blob/6f82f8c884265184823efd71851fdbc4ec49aa02/docs/superpowers/specs/2026-08-24-email-attachment-detail-contract-design.md) 刻意讓 `email send` machine-readable output 保留完整 `SendEmailResponse` wrapper，包含 `email`、`attachments`、`attachment_availability` 與 `idempotent_replay`。本文件原本要求用 selector 只輸出 `email` 的部分已被取代；pretty output 仍可用 `dataPath: "email"` 顯示 Email object。

## 目標

這個 refactor 要把 generated command 與少數 handwritten command 共同使用的 SDK 呼叫收尾流程收斂到一個小 helper。完成後，command 仍然維持既有行為：先透過 `loadSdkClient()` 取得 authenticated SDK client，呼叫 generated SDK operation，失敗時輸出同樣格式的 HTTP error 並設定 `process.exitCode = 1`，成功時交給 `render()`。

目標不是改 CLI UX，也不是重寫 codegen。這次只處理已經重複出現的 raw client 存取、SDK result error 判斷、stderr 格式與 render dispatch。

## 目前味道

`tools/cli-codegen/emit.ts` 產生的每個 generated command 都內嵌一段相同流程：`loadSdkClient()`、把 `client._rawClient` 傳給 generated SDK operation、判斷 `result.error || !result.response?.ok`、寫出 `HTTP <status>: <json error>`、設定 exit code，最後呼叫 `render()`。

`src/handwritten/commands/todo-done.ts` 與 `src/handwritten/commands/email/send.ts` 也有幾乎相同的收尾流程。`email/send.ts` 因為有特殊 body validation 與回傳 envelope，只需要保留前段 validation 與 body construction，SDK result handling 不需要自己再寫一次。

這讓 command 行為的小修正必須同步改 generator 與 handwritten command；同時 raw client cast 分散在多處，增加 type drift 風險。

## 設計

新增一個 handwritten helper，建議放在 `src/handwritten/commands/sdk-result.ts` 或同等既有 boundary 下。helper 保持很小，輸入包含 operation callback、operation args、render context，以及可選的 success data selector。

helper 的責任只到這裡：

- 呼叫 `loadSdkClient()`。
- 將 loaded client 的 raw SDK client 傳給 callback。
- 判斷 generated SDK result 是否失敗。
- 維持目前 stderr 格式與 `process.exitCode = 1` 行為。
- 成功時用 `render(ctx, selectedData)` 輸出。

helper 不負責 command option parsing、不負責 validation、不負責 retries，也不改 generated SDK 型別。raw client 存取集中在 helper 內即可；如果型別仍需要 `as never`，只讓它存在一處。

`tools/cli-codegen/emit.ts` 改成產生呼叫 helper 的 command body。產出的 command 不應改變 operation path/body/query 組裝規則，也不應改變 display hint literal。

`todo-done.ts` 改用同一個 helper，保留 `TODO_UPDATE_DISPLAY`。`email/send.ts` 在完成 text、reply、attachment validation 與 body construction 後，使用 helper 呼叫 `emailSend`。最初版本用 data selector 選出 `result.data!.email`；2026-08-25 起依上方 superseding contract 改為保留完整 result，並只在 pretty rendering 透過 `dataPath` 顯示 nested Email。

## 範圍

包含：

- 新增一個 SDK result helper。
- 更新 codegen emitted command body。
- Regenerate `src/generated/cli/`。
- 更新 `todo-done.ts` 與 `email/send.ts` 使用 helper。
- 調整既有 codegen 與 handwritten command 測試。

不包含：

- 不改 `loadSdkClient()` 的 auth、account、consistency bookmark 行為。
- 不改 `render()` 的 pretty 或 JSON policy。
- 不改 OpenAPI metadata。
- 不新增 retry、telemetry、command middleware 或抽象 command framework。

## 實作提示

先寫或調整 generator 測試，確認 emitted command 會 import helper 並保留 path、query、body、parser、display 與 error 行為。接著實作 helper，再跑 `npm run generate` 讓 generated output mechanically 更新。

helper 可以回傳 `Promise<void>`，command action 只要 `return runSdkCommand(...)`。如果 selector 回傳 `undefined`，helper 應沿用目前 `render()` 行為：`render()` 收到 `undefined` 會不輸出。

`email/send.ts` 的 validation error 仍然留在 command 內，因為那不是 SDK result handling 的重複問題。

## 測試

最小驗證：

- `npm test -- tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts`
- `npm test -- test/handwritten/email-send.test.ts`
- `npm run generate`
- `npm run typecheck`

若 generated diff 很大，只檢查產物是否是 helper import 與 action body 的機械變化，不應混入 OpenAPI spec 或 SDK generated output。

## 接受標準

- Generated command 的 success 與 failure behavior 維持現有測試語意。
- `todo done` 的 output 與 error behavior 不變。
- `email send` 的 validation、attachment limit、pretty success render 與 HTTP error behavior 不變；machine-readable output 依 superseding contract 保留完整 `SendEmailResponse` wrapper。
- raw SDK client cast 只存在於新 helper 或同等單一邊界。
- 沒有新增 dependency，沒有新增 command middleware framework。

# Drive realtime optional field builder refactor 設計

## 來源

這份 spec 對應 WSPC todo `tod_01KVND96E2WP6EEBAQV2Q9ZR3Y`：`Shrink Drive realtime optional field builder`。

Todo 內容把目標定義成一個 Ponytail shrink：移除 `src/handwritten/commands/drive/realtime.ts` 裡的一次性泛型 helper `optionalString<T, K>()`，用直接的 object spread literal 表達 optional `cursor`、`path`、`reason`、`code`、`message` 欄位，讓 realtime message shape 更容易讀。

## 目前狀態

最新 `origin/main` 的 `realtime.ts` 已經包含 Drive realtime coordinator、Node 24 原生 `WebSocket` connector、message parser、cursor persistence、low-sensitive warning、auth failure handling 與 reconnect backoff。`test/handwritten/drive/realtime.test.ts` 已鎖定主要行為：URL 不洩漏 token、known message parsing、unknown message redaction、ready replay、`library_changed`、`resync_required`、invalid cursor cleanup、auth close handling 與 stale message guard。

`optionalString()` 目前只服務這個檔案內的 object construction。它把「如果 value 是 string 才加欄位」包成泛型 helper，但呼叫點反而變成巢狀：

```ts
optionalString(optionalString({ type: "library_changed" }, "cursor", cursor), "path", value.path)
```

這個 helper 沒有跨檔重用，也沒有封裝重要 domain rule。它主要在處理 TypeScript object literal 型別，而不是 Drive realtime 行為。

## 目標

這次 refactor 只讓 `realtime.ts` 的 optional object construction 變得直白。完成後，讀者應能在每個 branch 看到完整輸出 shape，而不是跳到泛型 helper 才知道欄位何時出現。

成功標準是：

- `optionalString()` 被刪除。
- `parseDriveRealtimeMessage()` 回傳的 union shape 不變。
- `handleMessage()` 對 handlers 的 event payload 不變。
- `resyncRealtimeState()` 對 invalid cursor 與 normal cursor 的 state update 不變。
- 既有 realtime tests 繼續通過。

## 不在範圍內

這不是 realtime protocol refactor，也不是 WebSocket library 選型。不要在這次改動中：

- 改 `DriveRealtimeMessage` union。
- 改 server message type、cursor semantics、redaction 規則、auth failure 判斷或 reconnect backoff。
- 改 `nativeWebSocketConnector()` 或引入 `partysocket`。
- 新增通用 object builder、factory、schema library 或跨 repo helper。
- 修改 `src/generated/`。

## 設計

實作應用最短可讀 diff。每個 optional string 欄位直接用 spread literal：

```ts
return {
  type: "library_changed",
  ...(cursor === undefined ? {} : { cursor }),
  ...(typeof value.path === "string" ? { path: value.path } : {}),
}
```

`handleMessage()` 的 event payload 也用同樣形式：

```ts
handlers?.onEvent({
  debounce_ms: 2000,
  reason: "library_changed",
  ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
  ...(message.path === undefined ? {} : { path: message.path }),
})
```

這種寫法重複一點點條件，但每個 message branch 的輸出 shape 都在同一段程式裡。這比保留單一泛型 helper 更便宜，也更符合這個檔案目前的局部複雜度。

`resyncRealtimeState()` 的 normal cursor branch 也應直接回傳 object literal：

```ts
return {
  ...realtime,
  last_event_at: lastEventAt,
  ...(cursor === undefined ? {} : { last_cursor: cursor }),
}
```

invalid cursor branch 仍保留現有 destructuring，因為它的行為是刻意移除 `last_cursor`。

## 測試策略

遵守 TDD，但這是 readability refactor，不新增行為。最小驗證是先跑現有 focused test，確認目前為綠，再改實作，最後跑同一組測試與 typecheck。

建議指令：

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
npm run typecheck
git diff --check
```

如果 TypeScript 對 union narrowing 變嚴，優先調整 local object literal 型別，不新增 helper 逃避型別檢查。

## Grill-me review 結論

狀態：ready。

已鎖定決策：

- 這是單檔 shrink，不是 protocol 或 dependency change。
- `optionalString()` 沒有 domain ownership，只是一次性 object builder。
- Direct spread literal 是接受的少量重複，因為它讓每個 message shape 原地可讀。
- 既有 realtime tests 已覆蓋這次 refactor 的行為邊界。

剩餘風險很低：主要是 TypeScript union inference 可能需要小幅型別提示。若發生，仍應把提示留在 branch-local object construction，不要重新引入通用 helper。

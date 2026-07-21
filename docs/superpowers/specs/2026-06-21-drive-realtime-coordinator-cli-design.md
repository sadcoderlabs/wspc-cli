# Drive realtime coordinator CLI 設計

## 來源

- Todo：`tod_01KVK1Q0XFGSY68DVJCE34SQEV`
- 交接文件：`sadcoderlabs/wspc-cli Drive 即時協調實作交接`
- 前置規格：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 前置規格：`docs/superpowers/specs/2026-06-21-drive-sync-watch-design.md`
- 前置規格：`docs/superpowers/specs/2026-06-21-drive-conflict-merge-policy-design.md`

## 目前 Main 現況

截至本文件寫作時，最新 `origin/main` 已包含 `wspc drive bind`、`wspc drive sync once`、`wspc drive watch`、conflict merge policy、`.wspc-drive/state.json`、Drive handwritten command 與對應測試。`drive watch` 已經是 `runDriveSyncOnce(root)` 的排程層：啟動時先跑一次 sync，之後由 chokidar event debounce 觸發同一個 sync engine；sync 執行中收到事件時只設定 trailing rerun flag。

這份 spec 不重新設計 sync engine、manifest diff、local scanner、conflict merge、chokidar watch 或 command tree。M5 realtime coordinator 的 CLI 工作是把遠端 WebSocket event 接到既有 watch scheduler，讓遠端更新和本機檔案事件都只成為 full sync hint。

## 目標

在 `@wspc/cli` 的既有 foreground watch mode 加入 per-library realtime coordinator 連線：

```bash
wspc drive watch [path]
```

完成後，watch mode 需要同時做三件事：

- 啟動時照現況先執行一次 `runDriveSyncOnce(root)`。
- 繼續使用 chokidar 監看本機 sync root。
- 讀取 `.wspc-drive/state.json` 的 `library_id` 與 realtime metadata，連線到 `/drive/libraries/{library_id}/realtime`，收到 server event 後排程同一個 `runDriveSyncOnce(root)`。

遠端 event 不是資料本身。正確性仍只來自 `runDriveSyncOnce(root)` 的 local scan、remote manifest、state 三方比較。即使 WebSocket 重複、延遲、漏事件或 cursor 失效，也不能直接用 event payload 修改 local file、state entry、conflict record 或 remote manifest cache。

## 不在範圍內

- 新增 background daemon、launch agent、system tray 或自動開機服務。
- 新增 Drive 專屬 JSON flag。
- 新增第二套 sync decision engine。
- 對 event payload 做單檔套用、patch、diff 或 manifest cache 更新。
- 固定 interval polling。第一版 WebSocket 長期失敗時，保留本機 watch，使用者可手動跑 `drive sync once`。
- Realtime protocol 的 server 實作。CLI 只消費後端 M5 已提供的 endpoint。
- 新增 `partysocket` dependency。Node 24 已有 WebSocket runtime；先用原生 `WebSocket` 加小型 reconnect wrapper，等原生能力真的不足再引入 dependency。

## State 擴充

`.wspc-drive/state.json` 沿用 `schema_version: 1`，新增 optional `realtime` object。舊 state 沒有這個欄位時仍必須可讀，watch 啟動時補齊缺少的 `client_id`。

```json
{
  "schema_version": 1,
  "library_id": "lib_...",
  "created_at": "2026-06-21T10:00:00.000Z",
  "updated_at": "2026-06-21T10:00:00.000Z",
  "entries": {},
  "conflicts": {},
  "realtime": {
    "last_cursor": "000000000000000123",
    "last_connected_at": "2026-06-21T10:00:00.000Z",
    "last_event_at": "2026-06-21T10:05:00.000Z",
    "client_id": "drvcli_01..."
  }
}
```

`client_id` 是 opaque local id，不含 device name、hostname、username、email 或 path。若 state 沒有 `realtime.client_id`，CLI 建立一個 `drvcli_` 前綴的本機 id 並用既有 `writeDriveState()` 持久化。`last_cursor`、`last_connected_at`、`last_event_at` 都是 metadata，不是 correctness boundary。

`last_cursor` 只在 event 已被接受並排程 sync，或 ready replay 已完成處理後更新。若 process 在收到 event 與 sync 完成之間 crash，下一次 reconnect replay 可能重複收到 event；這可接受，因為 handler 只觸發 idempotent full sync。

Realtime metadata 寫入與 sync 共用 folder lock。若寫入遇到正在進行的 sync 而回傳 `WSPC_DRIVE_LOCK_HELD`，client 應合併為最新 realtime state 並繼續重試；這是預期的內部 contention，不輸出 realtime warning。其他持久化錯誤仍輸出低敏 warning。

`state.ts` 的 schema guard 要接受 optional `realtime`，並拒絕 malformed realtime fields。這是 trust boundary，不能因為只是 metadata 就放寬成任意 object。

## Realtime 連線

CLI 從既有 authed API client layer 取得 base URL 與 authenticated fetch boundary，然後推導 WebSocket URL：

```text
https://api.wspc.ai -> wss://api.wspc.ai/drive/libraries/{library_id}/realtime
http://127.0.0.1:8787 -> ws://127.0.0.1:8787/drive/libraries/{library_id}/realtime
```

Query string：

```text
?cursor={last_cursor}&client_id={client_id}
```

`cursor` 只有 state 已有值時才送。`client_id` 必須送。不要把 bearer token、API key、refresh token 或其他 secret 寫入 URL query 或 state。

Auth 沿用現有 CLI auth 設定。若後端 endpoint 需要 bearer token，WebSocket wrapper 可以從既有 auth layer 取得短期 access token 或等價的 authed connection mechanism；但 token 只能存在 memory 中，不得保存到 `.wspc-drive/state.json`，log 也不得輸出完整 URL query 或 Authorization header。

所有 HTTP fallback 或 token refresh 仍應走現有 auth/config boundary。Drive API request 維持 `createConsistencyFetch()` 的 consistency bookmark 行為；WebSocket event 不參與 bookmark 寫回，也不能繞過 sync once 的 manifest request 來宣稱已同步。

## Server Message Handling

第一版只需要處理下列表型：

| Type | CLI 行為 |
| --- | --- |
| `ready` | 保存 server 提供的最新 cursor；如果 `replayed > 0`，排程一次 full sync |
| `library_changed` | 保存 event cursor 與 `last_event_at`，排程 debounced full sync |
| `resync_required` | 保存 latest cursor 與 `last_event_at`，立刻排程 full sync |
| `error` | 記錄低敏 summary；通常保留連線，除非 server 關閉或錯誤代表 auth failure |

CLI message 第一版只需要 optional application ping：

```json
{ "type": "ping" }
```

不要把 local path、檔案內容、diff、manifest、hash、state snapshot 或 token 送到 WebSocket。

若收到 unknown message type，CLI 應輸出低敏 warning 並忽略該 message。unknown message 不應停止 watch，也不應觸發 sync，除非後端以 `resync_required` 明確要求。

## Scheduler 整合

現有 `runDriveWatch()` 已有 `requestSync()`、debounce timer、`running` 與 `rerunRequested`。Realtime 應重用這個 scheduler，而不是新增第二套 queue。

本機 chokidar event 與 remote event 的共同規則：

- 若 sync 未執行，event 進 debounce timer。
- 若 sync 正在執行，只設定 `rerunRequested = true`。
- 多個 remote events 在 `2` 秒內合併成一次 sync。
- 若 local event 已排程 sync，remote event 不啟動第二個 sync，只共用同一個 pending sync。
- `resync_required` 可以跳過 debounce，直接呼叫同一個 `requestSync()`；若正在 sync，仍只設定 rerun flag。

現有 local watch debounce 是 `500ms`。Realtime remote debounce 第一版用固定 `2000ms`，不新增 CLI flag。需要調整時先在程式內保留 injection point 給測試，不暴露使用者設定。

## Reconnect 與 Fallback

WebSocket 斷線不停止 `drive watch`。CLI 保留本機 chokidar watch，並用 exponential backoff 重連：

| 狀況 | 行為 |
| --- | --- |
| 正常 close / network error | 從 `1` 秒開始 backoff，最高 `60` 秒，持續重連 |
| reconnect ready replay 成功 | 如果 replayed events 大於 0，排程 sync |
| `resync_required` | 立刻排程 full sync |
| cursor invalid | 清空 local `last_cursor`，持久化 state，重連或排程 full sync |
| `401` / `403` / auth failure | 停止 realtime reconnect，提示重新 login 或確認權限；本機 watch 是否繼續依既有 sync auth failure 策略停止 |

WebSocket 長時間無法連線時，第一版不做固定 polling。CLI output 要清楚顯示 realtime reconnecting，避免使用者誤以為遠端更新仍會即時抵達。若未來要加入 safety polling，間隔不得低於 `5` 分鐘，且必須另寫 spec，避免 foreground watch 偷偷變成 daemon-like polling service。

## Output

Human output 使用既有 renderer，不新增 output framework。新增 event kind 時沿用 `drive_watch` / `drive_sync_once` 的 newline event 風格。

建議事件：

- `drive_watch_started`：沿用現況，包含 root 與 library id。
- `drive_realtime_connected`：顯示 library realtime connected。
- `drive_realtime_event`：顯示收到 remote update、reason 或 path summary，文字需表達「收到更新，正在同步」，不能說「檔案已更新」。
- `drive_realtime_reconnecting`：顯示 delay 與低敏 error summary。
- `drive_realtime_auth_failed`：提示重新 login 或確認權限。
- `drive_sync_once`：沿用現有 sync summary，這才是實際同步結果。

`--json` 模式下輸出 newline-delimited JSON object。這仍是 CLI structured log stream，不是正式 Drive protocol；不要新增 ad-hoc `--drive-json` 或 `--realtime-json`。

## 安全與隱私

`.wspc-drive/state.json` 不保存 access token、refresh token、API key、Authorization header、hostname、username、email、absolute path、manifest、diff 或檔案內容。

Logs 不輸出 raw headers、Authorization、token、完整 WebSocket URL query、檔案內容、manifest 或 raw server error body。Remote event 中的 relative `entry.path` 可以在一般模式輸出，因為既有 Drive sync summary 已會顯示 relative path；debug output 不應比現有 sync summary 擴大更多敏感資料。

Event payload 中的 path 若要輸出，仍應視為 display-only。任何會影響檔案系統或 state 的 path 都必須由下一輪 `runDriveSyncOnce(root)` 重新透過 manifest 與 local scan 驗證。

## 測試策略

遵守 TDD。最小測試集合：

- State tests：舊 state 沒有 `realtime` 仍可讀；valid realtime metadata 可讀寫；malformed `client_id`、`last_cursor`、timestamp 會被拒絕；缺少 client id 時 watch 會建立 opaque local id 並保存。
- URL/auth tests：從 API base URL 推導 `ws` / `wss` endpoint；cursor 只在存在時送；client id 必送；token 不寫入 state，也不出現在 log event。
- Message tests：`ready` replay、`library_changed`、`resync_required` 都透過同一個 sync scheduler 排程 full sync；unknown message 忽略；`error` 只輸出低敏 summary。
- Debounce tests：local 與 remote events 共用同一 pending sync；sync running 時只設定 rerun flag；remote events 在 `2` 秒內合併。
- Reconnect tests：network close/backoff 到上限 `60` 秒；successful connect reset backoff；`401`/`403` 停止 reconnect 並輸出 auth failure。
- Cursor tests：event 被接受後保存 cursor；cursor invalid 時清空 cursor 並排程 full sync；crash/replay 重複 event 不會直接改 state entries。
- Safety tests：event payload 不直接改 local file、state entries、conflicts 或 manifest cache；真正同步仍呼叫 `runDriveSyncOnce(root)`。
- Watch integration tests：fake local source 與 fake realtime source 共用 queue；realtime source close 時 local watch 仍可觸發 sync。

測試不需要真實 WSPC API 或真實 WebSocket server。`runDriveWatch()` 應延續現有 injection 風格，讓測試注入 fake sync、fake local source、fake realtime source 與 fake timers。若需要拆檔，優先抽出最小的 realtime client wrapper 與 URL/message helpers；不要為單一實作新增大型 interface/factory。

## 實作切片

第一個切片只做必要檔案：

1. 擴充 `state.ts` 的 `DriveState` 型別、schema guard 與 client id helper。
2. 新增最小 realtime WebSocket helper，負責 URL 推導、message parse、backoff reconnect 與 close cleanup。
3. 擴充 `runDriveWatch()`，讓 local source 與 realtime source 共用既有 `requestSync()`。
4. 補 output event 與低敏 error summary。
5. 補測試與 README 的 Drive watch 說明。

不要改 generated command。`wspc drive watch [path]` 已經是 handwritten command，realtime 是這個 command 的行為擴充。

## Grill-me review 結論

狀態：ready with risks。

已鎖定決策：

- Realtime event 是 sync hint，不是資料來源。
- watch 仍是 foreground process，不新增 daemon 或 polling service。
- 本機 chokidar event 與 remote WebSocket event 共用同一個 sync scheduler。
- 第一版使用 Node 24 原生 WebSocket，不先加 `partysocket`。
- `.wspc-drive/state.json` 沿用 schema version 1，新增 optional realtime metadata。
- 真正同步結果只以 `drive_sync_once` summary 為準。

剩餘風險：

- 後端 realtime protocol 的精確 error payload 與 cursor invalid 表示法若和本 spec 不同，實作時需要用 live OpenAPI 或後端文件校正 message parser。
- Node 24 原生 WebSocket 若在目標 runtime 對 headers/auth 有限制，可能需要改用已驗證的小型 WebSocket dependency；這是 implementation fallback，不改變 CLI 行為。
- 沒有 safety polling 代表 WebSocket 長期失敗時遠端-only 更新不會即時同步；第一版接受這個風險，避免 foreground watch 變成隱性 polling daemon。

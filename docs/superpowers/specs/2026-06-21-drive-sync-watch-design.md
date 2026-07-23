# Drive sync watch 設計

## 來源

- Todo：`tod_01KVM3WAM4XHM9TZQHC4B1WVMD`
- 前置規格：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 前置實作：PR #31 已完成 `wspc drive bind` 與 `wspc drive sync once`
- 首次同步 recovery canonical spec：[current](https://github.com/sadcoderlabs/wspc-drive/blob/main/docs/superpowers/specs/2026-07-23-drive-first-sync-recovery-design.md)、[pinned revision `591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3`](https://github.com/sadcoderlabs/wspc-drive/blob/591a2ac58d6ba51025e4bd42c0bbc0d6603d96f3/docs/superpowers/specs/2026-07-23-drive-first-sync-recovery-design.md)

## 目標

在 `@wspc/cli` 加入 `wspc drive watch [path]`，讓已 bind 的本機資料夾可以長時間監看本機檔案變更，並安全觸發既有 `sync once`。

這個功能是現有 manual sync 的薄包裝，不新增第二套同步邏輯。watch 只負責：

- 啟動時跑一次 sync。
- 監看本機 sync root 的檔案事件。
- debounce 後觸發 `runDriveSyncOnce(root)`；local event 可帶 dirty paths 做 incremental scan，initial、remote 與 retry trigger 做 full reconciliation。
- 如果 sync 正在執行，記錄 trailing rerun，等本輪結束再補跑一次。
- 對 transient failure 遵守 `Retry-After` 或 exponential fallback，並執行 full retry。

## 不在範圍內

- 遠端 push notification 或 realtime coordinator。
- remote polling interval。
- operation queue。
- ignore rules。
- rename detection。
- watch 自己不重作 stale lock recovery；`sync once` 的 lock 層可回收超過 10 分鐘的 stale lock。
- automatic merge 或 conflict copy。
- background daemon / launch agent / system tray。

## 指令

```bash
wspc drive watch [path]
```

`path` 省略時使用目前工作目錄。watch 使用和 `sync once` 相同的 folder-local state：

```text
.wspc-drive/state.json
```

如果缺少 state、state schema 不支援、或資料夾未 bind，command 非零結束並提示先執行：

```bash
wspc drive bind --library <library_id> [path]
```

## Watch backend

v1 使用 `chokidar` 監看本機 sync root。

理由：

- watch 是使用者可感知的長跑功能，跨平台事件穩定度比少一個 dependency 更重要。
- chokidar 使用方式簡單，能處理較多 macOS / Windows / Linux watcher 差異。
- watcher event 仍只用來排程完整掃描，不依賴 event payload 做單檔同步。
- 使用 chokidar 不改變同步正確性邊界：`runDriveSyncOnce(root)` 仍是唯一 sync engine。

watch 必須透過 chokidar ignore `.wspc-drive/` 內事件，避免 state write、lock、temp file 造成自我觸發迴圈。

## Sync loop

watch 啟動後流程：

1. resolve `path` 成 sync root。
2. 讀取 `.wspc-drive/state.json`，確認資料夾已 bind。
3. 建立 chokidar watcher。
4. 立即排程一次 sync。
5. 任一本機檔案事件把 library-relative path 加入 dirty set，並觸發 debounce timer。
6. debounce 到期後把 dirty snapshot 傳給 `runDriveSyncOnce(root)`；initial、remote 與 retry 不傳 snapshot。
7. 如果 sync 執行中又收到事件，只設定 `rerunRequested = true`。
8. 本輪 sync 結束後，如果 `rerunRequested` 為 true，清掉 flag 並立刻再跑一輪。

Debounce 初始值固定為 500ms。v1 不加 CLI flag；需要 tuning 時再新增。

Pseudo flow：

```ts
let running = false
let rerunRequested = false

async function requestSync() {
  if (running) {
    rerunRequested = true
    return
  }
  running = true
  try {
    do {
      rerunRequested = false
      await runDriveSyncOnce(root)
    } while (rerunRequested)
  } finally {
    running = false
  }
}
```

## Failure handling

`sync once` 已經負責 path policy、manifest、decision、state durability、conflict reporting 與 lock。watch 不重作這些邏輯。

watch 只處理長跑 process 的錯誤策略：

| 狀況 | 行為 |
| --- | --- |
| 缺少 state / unsupported schema | 非零結束 |
| `sync lock already exists` | 非零結束，避免和另一個 sync process 競爭 |
| stale `.wspc-drive/sync.lock` | 交給 `sync once` lock 層回收後繼續執行 |
| auth expired / authorization required / 401 / 403 | 停止自動 retry，提示使用者重新 login |
| network / 429 / 5xx / temporary fetch failure | 第一筆 failure 中斷本輪，保留 process，等待後重跑 full sync |
| unresolved conflict | 印出 summary，process 保持執行，後續事件仍可同步其他 path |
| local path error / case conflict | 印出 summary，process 保持執行，等待使用者修正檔名後下一輪再掃描 |

Retry delay：

- 合法 `Retry-After` 支援 delta-seconds 與 HTTP-date，且完整遵守，不套用 60 秒上限。
- Header 缺少或無效時才使用 1 秒起跳、每次乘 2、上限 60 秒的 fallback。
- 任一次成功 sync 後把 fallback reset 為 1 秒。
- Watch process 還在時不設 retry attempt cap；retry trigger 一律不用上一輪 dirty-path snapshot，而是 full reconciliation。

v1 不把 backoff 狀態寫入 `.wspc-drive/state.json`。

## Output

watch 應沿用現有 renderer，不新增獨立 output framework。

啟動時 human output 顯示：

- sync root
- library id
- watching 狀態

每輪 sync 完成後顯示 compact summary，欄位沿用 `drive_sync_once`：

- uploaded
- downloaded
- deleted
- unchanged
- conflicts
- errors

`--json` 模式下，watch 輸出 newline-delimited JSON event，每列一個 object：

- `{ "kind": "drive_watch_started", ... }`
- `{ "kind": "drive_sync_once", ... }`
- `{ "kind": "drive_watch_retry", ... }`

`drive_watch_retry` 的 additive optional fields 為 `reason`、`remaining` 與 `path_errors`，`delay_ms` 是本輪實際等待毫秒數，`error` 只輸出 `HTTP 429` 這類 safe summary。`drive_sync_once` 可帶 `path_errors`，每筆包含 `path`、`code`、`message`、`retryable`。Producer 與 consumer 都必須忽略未知 optional fields；本 contract 不新增全域 protocol version。完整 fixture 以 pinned canonical spec 為準。

## Mounting

`src/cli.ts` 的 `mountDriveCommands()` 目前會把 handwritten `bind` 和 `sync once` 掛到 generated `drive` command tree。

watch 應掛在同一棵樹：

```text
wspc drive watch [path]
```

如果 generated OpenAPI 未來也產生 `drive watch`，handwritten mount 不應重複加入同名 command。

## 測試

最小測試：

- Command mount：`wspc drive --help` 包含 `watch`。
- Startup：watch 啟動時會先跑一次 sync。
- Debounce：多個 chokidar events 只觸發一次 sync。
- Single-flight：sync 執行中收到事件，只在結束後補跑一輪。
- Ignore internal files：`.wspc-drive/` 事件不觸發 sync。
- Transient retry：429 遵守 `Retry-After`，network / 5xx 缺少 header 時使用 capped exponential fallback，且 retry 一律 full scan。
- Recovery event：驗證 `reason`、`delay_ms`、optional `remaining` 與 `path_errors`，以及連續四次以上 failure 沒有 attempt cap。
- Auth stop：auth error 不會無限 retry。
- Conflict keepalive：sync summary 有 conflicts 時 process 不退出。

測試不需要真實 WSPC API。watch module 應可注入：

- fake `runSync`
- fake watcher source
- 提供 injected clock 的 cancellable fake timer

CLI smoke test 再確認 command tree 掛載即可。

## Grill-me review 結論

狀態：ready with risks。

已鎖定決策：

- watch 是 `sync once` 的排程層，不重作同步決策。
- v1 使用 chokidar，因為跨平台 watcher 穩定度值得這個小 dependency 成本。
- watch 不處理遠端即時通知，也不做 remote polling。
- transient failure 保持 process，auth / binding / lock failure 直接停止。

剩餘風險：

- chokidar 仍可能合併、重複或延遲事件，因此 event payload 不可作為 correctness 依據。
- 長跑 CLI 的 JSON output 若未來要成為正式 protocol，需要另行穩定化。
- 沒有 remote polling 代表「只有遠端變更且本機無事件」不會即時同步，需使用者手動 `sync once` 或等待未來 realtime/polling 功能。

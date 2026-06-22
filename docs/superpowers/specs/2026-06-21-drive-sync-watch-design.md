# Drive sync watch 設計

## 來源

- Todo：`tod_01KVM3WAM4XHM9TZQHC4B1WVMD`
- 前置規格：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 前置實作：PR #31 已完成 `wspc drive bind` 與 `wspc drive sync once`

## 目標

在 `@wspc/cli` 加入 `wspc drive watch [path]`，讓已 bind 的本機資料夾可以長時間監看本機檔案變更，並安全觸發既有 `sync once`。

這個功能是現有 manual sync 的薄包裝，不新增第二套同步邏輯。watch 只負責：

- 啟動時跑一次 sync。
- 監看本機 sync root 的檔案事件。
- debounce 後觸發完整 `runDriveSyncOnce(root)`。
- 如果 sync 正在執行，記錄 trailing rerun，等本輪結束再補跑一次。
- 對 transient failure 做簡單 retry。

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
5. 任一本機檔案事件觸發 debounce timer。
6. debounce 到期後執行 `runDriveSyncOnce(root)`。
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
| network / 429 / 5xx / temporary fetch failure | 保留 process，exponential backoff 後重跑 full sync |
| unresolved conflict | 印出 summary，process 保持執行，後續事件仍可同步其他 path |
| local path error / case conflict | 印出 summary，process 保持執行，等待使用者修正檔名後下一輪再掃描 |

Backoff：

- 起始 1 秒。
- 每次失敗乘 2。
- 上限 60 秒。
- 任一次成功 sync 後 reset。

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

`--json` 模式下，watch 可以輸出 newline-delimited JSON event，每列一個 object：

- `{ "kind": "drive_watch_started", ... }`
- `{ "kind": "drive_sync_once", ... }`
- `{ "kind": "drive_watch_retry", ... }`

v1 不需要保證這是穩定外部 protocol；它只是 machine-readable CLI output。

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
- Transient retry：network / 5xx 類錯誤會 backoff 後重試。
- Auth stop：auth error 不會無限 retry。
- Conflict keepalive：sync summary 有 conflicts 時 process 不退出。

測試不需要真實 WSPC API。watch module 應可注入：

- fake `runSync`
- fake watcher source
- fake timer

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

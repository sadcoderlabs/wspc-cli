# Drive menu bar app roadmap

## 目標

建立一個 macOS menu bar app，讓使用者不用長期開 terminal 也能操作 WSPC Drive watch。

第一版以「更懶、更穩」為原則：desktop app 只做薄包裝，沿用現有 `@wspc/cli` 的 auth、Drive bind、`drive watch --json` 與 sync correctness boundary。每個 milestone 之後再各自撰寫詳細 spec，不在這份 roadmap 一口氣設計完所有細節。

## 已定結論

- 第一版使用 Electron，不使用 Tauri。
- 第一版採用 CLI sidecar 路線，不直接 import Drive watch core。
- Electron app 會打包固定版本的 `@wspc/cli`，不使用使用者系統 PATH 裡的 `wspc`。
- app 更新時更新整個 Electron bundle，CLI 版本跟著 app 版本走。
- 第一版不使用 Bun compile 或 Node SEA；Electron 既有 Node runtime 已足夠。
- `wspc-cli` 暫時維持獨立 repo，不改 monorepo。
- 如果未來需要直接呼叫 Drive watch core，再考慮抽 shared package 或改 monorepo。

## 建議架構

```text
Electron menu bar app
  -> bundled @wspc/cli JS entry
  -> wspc drive watch --json <folder>
  -> newline-delimited JSON events
  -> app status / history UI
```

第一版可以用 Electron 的 Node runtime 執行 bundled CLI：

```ts
spawn(process.execPath, [cliEntry, "drive", "watch", "--json", folder], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
})
```

app state 只保存 desktop app 自己需要的設定，例如 watched folder、auto launch、最近事件摘要。auth/config 繼續由既有 CLI 使用 `~/.wspc` 管理。

## Milestone 1：Menu bar shell 與 bundled CLI smoke

目標是先證明 Electron app 可以穩定打包並呼叫 bundled CLI，不碰長跑 sync lifecycle。

範圍：

- 建立獨立 TypeScript Electron project。
- 建立 macOS menu bar / tray shell。
- 打包固定版本的 `@wspc/cli` JS entry。
- 顯示 app version 與 bundled CLI version。
- 從 app 呼叫簡單 CLI smoke，例如 `wspc --version` 或 `wspc drive --help`。
- 建立最小 macOS dev build / packaged build 流程。

不做：

- 不啟動 `drive watch`。
- 不做登入 UI。
- 不做 auto update。
- 不做開機自動執行。

完成後再寫 M2 spec。

## Milestone 2：Drive watch control

目標是把 menu bar app 變成可靠的 `drive watch` 控制器。

範圍：

- 選擇或記住一個已 bind 的 Drive folder。
- 啟動 bundled CLI：`wspc drive watch --json <folder>`。
- 停止 watch child process。
- 顯示狀態：stopped、starting、running、syncing、error、auth needed。
- 解析 newline-delimited JSON events，先只顯示最近狀態與低成本 log。
- 處理 app quit 時停止 watch。
- 處理 CLI crash，顯示錯誤，不自動無限重啟。
- 保留既有 CLI correctness boundary，不重寫 sync engine。

不做：

- 不直接 import Drive watch core。
- 不新增另一套 sync history protocol。
- 不做 background daemon。
- 不做多 folder watch。

完成後再寫 M3 spec。

## Milestone 3：登入、歷史與 auto launch

目標是補齊第一版產品可用性，但仍維持 thin wrapper。

範圍：

- 登入 UI：優先包現有 CLI login flow，而不是重寫 OAuth。
- 顯示目前登入狀態與 active account。
- 顯示最近同步檔案歷史，資料來源是 `drive watch --json` events。
- 保存最近 N 筆歷史到 app-local storage。
- 設定是否開機自動執行。
- auto launch 後依使用者設定恢復 watch。
- 更新前停止 watch，更新後讓 app 依設定恢復。

不做：

- 不實作完整 Drive activity database。
- 不把 CLI auth 狀態搬進 app 私有 storage。
- 不處理多帳號同步策略，除非 CLI 已經提供足夠明確的 account selection 行為。

完成後再評估 M4。

## Milestone 4：視痛點再做的項目

只有在 M1 到 M3 暴露真問題後才做。

可能項目：

- Electron auto update 與 macOS signing / notarization 強化。
- 多 folder watch。
- 更完整的 sync history。
- app 內 Drive bind helper。
- 從 CLI sidecar 改成 direct core import。
- 抽 shared package 或改 monorepo。
- Node SEA 產出獨立 CLI binary。

這些目前不是第一版必要條件。

## Spec 拆分順序

1. M1 spec：只處理 Electron shell 與 bundled CLI smoke。
2. M2 spec：處理 `drive watch --json` lifecycle。
3. M3 spec：處理登入 UI、history、auto launch。
4. M4 spec：只在有實際痛點時撰寫。

每份 spec 都應先重新讀當時的 `wspc-cli` README、Drive watch spec、CLI help 與 Electron project 現況，再決定是否調整 milestone 邊界。

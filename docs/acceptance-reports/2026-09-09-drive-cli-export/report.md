# 驗收報告：Drive CLI export

Todo：`tod_01M22QHM66YJ8NENW2YAB98MPK`；2026-09-09。

[跨 repo 完整驗收報告](https://github.com/sadcoderlabs/wspc/blob/a81e549e3c4173df23970979c28f87253a1c03a7/docs/acceptance-reports/2026-09-09-drive-cli-export/report.md) 保存 governing spec、AC1–10 對照、合成 tar manifest／hash、本地 CLI transcript、兩個 Workspace 隔離與 cleanup，以及三平台 OS peak RSS 原始數值。

CLI 實作 SHA：`7211be0184b10d97ee980e0abffcc13ef2b5b0ba`。已同步 main 的 Calendar Trash 功能；完整 721 tests、typecheck、build、generated freshness 通過。Generated snapshot 直接來自同一 backend worktree，沒有手改產物。

實際 CLI child 下載 128／512 MiB 各三次：最終本機 median peak RSS 增幅 8352 KiB，三平台 CI 的增幅亦皆低於 65536 KiB。Windows、macOS、Linux 均驗證 no-clobber publication／collision；macOS、Linux 另驗 SIGINT／SIGTERM 清理。

Repository standards review 與 governing contract review 分別通過；Ponytail review 刪除重複 Job type，改用 SDK type。Provider cancellation 診斷與 failed／expired next-step 的審查發現已補 red/green 測試並修正。

尚待 post-merge：backend deploy → 此 repo main 的 `release.yml`（minor、非 dry run）→ 安裝正式 npm version，於專用測試 Workspace 重跑建立／查詢／下載／tar hash／cleanup，並追加部署 SHA、CLI version／SHA、live OpenAPI hash。完成前 Todo 維持未完成。

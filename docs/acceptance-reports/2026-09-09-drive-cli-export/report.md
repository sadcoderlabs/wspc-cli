# 驗收報告：Drive CLI export

Todo：`tod_01M22QHM66YJ8NENW2YAB98MPK`；2026-09-09。

[跨 repo 完整驗收報告](https://github.com/sadcoderlabs/wspc/blob/e07b28e7b910218cfb213693e078c80c046240cf/docs/acceptance-reports/2026-09-09-drive-cli-export/report.md) 保存 governing spec、AC1–10 對照、合成 tar manifest／hash、本地 CLI transcript、兩個 Workspace 隔離與 cleanup，以及三平台 OS peak RSS 原始數值。

CLI 實作 SHA：`7211be0184b10d97ee980e0abffcc13ef2b5b0ba`。已同步 main 的 Calendar Trash 功能；完整 721 tests、typecheck、build、generated freshness 通過。Generated snapshot 直接來自同一 backend worktree，沒有手改產物。

實際 CLI child 下載 128／512 MiB 各三次：最終本機 median peak RSS 增幅 8352 KiB，三平台 CI 的增幅亦皆低於 65536 KiB。Windows、macOS、Linux 均驗證 no-clobber publication／collision；macOS、Linux 另驗 SIGINT／SIGTERM 清理。

Repository standards review 與 governing contract review 分別通過；Ponytail review 刪除重複 Job type，改用 SDK type。Provider cancellation 診斷與 failed／expired next-step 的審查發現已補 red/green 測試並修正。

Post-merge：PASS。Backend merge `a05257b1553c2fc8eec2b59c8f8ce15dfaabbf22` 已成功 deploy；CLI merge `ffc488f99874e6bbdd9d504204aca4615edca2a8` 的 exact-head check 與三平台 streaming CI 均成功，兩個 remote implementation branches 已刪除。

[Release workflow](https://github.com/sadcoderlabs/wspc-cli/actions/runs/34340662267) 成功發布正式 npm `@wspc/cli@0.9.0`，tag `v0.9.0`／release SHA `09ea48c34ef742633383b6102d231ebba8d6a4e2`，registry provenance 已確認。

使用正式套件在兩個獨立、單一 owner 且原本空白的 production 測試 Workspace 驗證 add／show／download、tar manifest／SHA-256、A-after-B、跨 Workspace 拒絕、no-clobber 與七天期限。合成 active files 與 Libraries 已 soft-delete，兩個 Library 清單恢復為空；live OpenAPI hash、匿名化 production manifest 與完整證據見上述跨 repo 報告。

Remaining acceptances：無。

# CLI 0.10.0 發布驗收

2026-09-09，[PR #129](https://github.com/sadcoderlabs/wspc-cli/pull/129) 已 squash merge 為 `c0fd3b6184006e8fe677795289a3f9de76540db4`。Exact head `0b25fe1629597dd887943af66cdd4ca06b17161d` 的 PR check、Linux／macOS／Windows streaming checks 全部通過；remote feature branch 已刪除。

[Release workflow 34353781876](https://github.com/sadcoderlabs/wspc-cli/actions/runs/34353781876) 成功完成 sync-spec、generate、typecheck、build、746 tests、npm trusted publishing 與 tag／GitHub release。正式版本：[v0.10.0](https://github.com/sadcoderlabs/wspc-cli/releases/tag/v0.10.0)，發布時間 `2026-09-09T12:55:18Z`，tag commit `e8f27c1264904a5381cb44f63a4c800c2042b677`。

npm registry readback 的 version 為 `0.10.0`，tarball integrity 為 `sha512-MsZZJPzlNyLIE4tcMHqASe3MAYYQF+c6ILHNeuBf5R4Rh/jQwOhqOvxu1GQ8OLBkiRhNER3NtMqZe+mjejNp5A==`。重新從 npm 安裝 package 後，binary 顯示：

```text
wspc 0.10.0 (spec 614e6932, fetched 2026-09-09T12:55:06.427Z)
```

使用這份 npm package 的 `dist/cli.js`，對 backend candidate `7ec6d6c40e22cdadb81f9dc92dd4116b8c910a5a` 重跑 [candidate report](report.md) 的實際 CLI process 操作，全部通過：[released-evidence.json](released-evidence.json)。包括 rm required flags／成功／stale rejection、sync upload／move 保留 ID／delete、同版本替換保留 winner、舊 state 缺 ID 拒絕且 state 不變。沒有用本機 source build 冒充 release；專用 local fixtures 已 soft-delete，未 purge，CLI environment 已恢復。

Backend AC9 的 CLI release、caller tests、released package candidate 驗收已滿足。Backend 仍需自己的最終 head CI、merge、production schema／雙 Account canary；CLI 發布本身不代表 backend 已 rollout。

# 驗收報告：移除 occurrence-time-zone parser marker

Todo：`tod_01M06JBQWT7N3XHRX0WS0HXE5Q`。依 [final spec](../../superpowers/specs/2026-09-09-occurrence-time-zone-marker-removal-design.md)。日期：2026-09-09；macOS arm64、Node 26.8.1。

## 變更與基準

Backend tz metadata 改成 `{ requestOnly: true }`；CLI 刪除沒有專屬 emitter 行為的 union member，fixture 使用普通 tz option。start/end marker 與所有 runtime parsing 均保留。

開始前 upstream source、live OpenAPI 與 CLI snapshot 共用 baseline；live SHA-256 為 `4d53f310788c4df9768d3a79d8aafef5b5063f02a20ae2eeaf48e91a5f514edb`。移除 marker 後的 source build 與已部署 schema，皆與該 baseline 僅差 tz.parser；不需另做無關同步。

## 驗收結果

| AC | 結果 | 證據 |
| --- | --- | --- |
| 1 | PASS | Backend 公開 OpenAPI test 先 22 passed / 1 failed，received 的 tz 多出 `parser: "occurrence-time-zone"`；刪 source metadata 後 Calendar 462 tests、OpenAPI 26+5 tests、typecheck/lint 通過。Production Calendar 與 merged metadata 皆只保留 requestOnly，見 [live evidence](assets/live-openapi.json)。CLI snapshot 經部署後 sync-spec 更新，只有一行刪除。 |
| 2 | PASS | 同一 baseline 的舊／新 emitter 生成整份 `src/generated/` 相同。實際 build 的 [help](assets/help.txt) 前後逐 byte 相同，只有一個 --tz。codegen test 驗普通 option、master fetch、parser argument；command tests 驗缺 start 或 end 時 Commander 拒絕。 |
| 3 | PASS | Generated command tests 透過 SDK seam 驗 GET 在 mutation 前、exact path/body、保留 expected_version、不送 tz body/query；GET 404 不送 mutation，維持 exit code 與錯誤訊息。 |
| 4 | PASS | Command/utils 覆蓋 leap-day 2028-02-29→2028-03-01 Exclusive End、2026-02-29 拒絕、all-day UTC hint 拒絕、Asia/Taipei 同 hint 接受、UTC hint 不合拒絕、missing zone 使用 UTC、忽略不同 WSPC_TZ 與 offset Instant 保留。新增 9 個 command cases 在舊實作即通過，沒有虛構 runtime red。 |
| 5 | PASS | 部署後 sync/generate，CLI 730 tests、typecheck、build、diff --check 通過；再次 generate 的 src/generated zero drift。CLI exact-head CI、merge/main readback 已通過，見下方。 |

## 部署與比對

Backend [PR #1234](https://github.com/sadcoderlabs/wspc/pull/1234) exact head `4f041334a3f63df0c6c038ca70facd0890c15e4c` 的 [CI](https://github.com/sadcoderlabs/wspc/actions/runs/34341865662) 全部 substantive checks 成功。Squash merge `80cc01af4ef1a83b475f1e9ddd1cc90379b56ec9` 已讀回 main，tree 與 reviewed head 相同，remote branch 已刪除。[Production deploy](https://github.com/sadcoderlabs/wspc/actions/runs/34342087560) 與 cross-worker smoke 成功後才執行 CLI sync。

Calendar live SHA-256：`dd44612ca7062711605592df731060fb3cc55b505804e02e69d6ff734513f609`；merged：`3ab9b5d18d0080187ac3bc7bbf4cef0dc1f5dff1320bb303fd645499e5b7f89a`。兩個 GET 都為 HTTP 200，options 保存於 JSON。

原始 command source 前後 SHA-256 均為 `70117ec2ff1f573d56f89e87821c8b82d0f287cf345d0ab8164388d8a94ece86`；原始 help 前後均為 `448f7b286501a91c43fd0edf3e40cebe0599979411fe1a8e2ddfa84bc2850043`。保存的 help.txt 僅去除結尾空白行，以符合 git diff --check。

重跑方式：`npm run sync-spec && npm run generate`、`npm run typecheck`、`env -u NO_COLOR TERM=xterm-256color npm test`、`npm run build`、`node dist/cli.js event occurrence set --help`，再 generate 與 `git diff --exit-code -- src/generated`。

## 審查

Repository standards：PASS。時間解析不變，generator/snapshot 經既有 pipeline 更新，僅 mock SDK/auth/output 邊界；文件繁體中文，無新增 dependency。新增測試的 nullable emitter 型別問題已修正，typecheck 與 focused tests 重跑通過。

Governing contract：PASS（pre-merge）。AC1–4 有完整證據，AC5 部署與可重現 checks 通過，剩餘 merge readback 明列。公開命令與 docs examples 不變，故不改 README/landing。

Ponytail review：Lean already. Ship. 刪除 marker／union，沿用既有 option emitter、Series Master 與 parser；只補規格所列 coverage 缺口。

## Post-merge 驗收

CLI [PR #127](https://github.com/sadcoderlabs/wspc-cli/pull/127) exact head `11741d1f4bf20c74bb3bd0ada0dbacdcc18cefad` 的 [CI check](https://github.com/sadcoderlabs/wspc-cli/actions/runs/34342381718) 成功，無未解 review threads。Squash merge `bbf22424831750db2e0a75a27d70991df92c3f45` 已從 remote main 讀回；tree 與 reviewed head 完全一致，remote implementation branch 已刪除。

以該 main checkout 再執行 `npm run generate`，`git diff --exit-code -- src/generated` 無差異；讀回 snapshot 的 tz 恰為 `{ requestOnly: true }`，union 無該 marker。Backend merge/deploy/live 證據如上，兩端交付完成。

## Remaining acceptances

無。依 final spec，完成至兩端 main 與 production metadata，不需 production Calendar 寫入或專屬 npm release；套件隨下次正常 release 發布。

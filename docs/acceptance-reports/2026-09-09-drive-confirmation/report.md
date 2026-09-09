# Drive confirmation CLI 發布驗收

日期：2026-09-09。CLI source：`3144976`，backend candidate：`7ec6d6c40e22cdadb81f9dc92dd4116b8c910a5a`（[WSPC PR #1237](https://github.com/sadcoderlabs/wspc/pull/1237)）。對應 WSPC Todo：`tod_01M2314VQ3B29YNMQFMX5HG136`。使用者已明確授權本次接手 CLI 發布；行為依 [backend final spec](https://github.com/sadcoderlabs/wspc/blob/bb461ad3299ba16ecd5b9e37f3bc313b25e52595/docs/superpowers/specs/2026-09-09-drive-move-delete-confirmation-design.md) AC9 與 CLI sync spec 的 2026-09-09 amendment。

## 修正與測試

Sync base 原已有 entry ID，但 API adapter 只傳 path／版本。現在 delete／move 傳送 base 的原 ID，不能從新 manifest 替換。缺 ID 的舊 state 維持 fail closed，尚未讀 manifest 就拒絕。Move 失敗停止，不退回 upload＋delete。`rm` 要求非空 `--entry-id` 與大於等於 1 的 safe-integer `--expected-entry-version`，不自動重送 conflict。

發布 pipeline 仍抓 live OpenAPI、generate、驗證並發布；handwritten rm 設定公開 command 的 required flags，避免尚未 rollout 的 backend schema 在 generate 時恢復 optional confirmation。Generated files 未手改；同時產生的 historical restore schema 更新是目前 live snapshot 的真實 drift。

TDD 修正前，delete／move HTTP request 缺 `entry_id`；move conflict 測試原本 resolved summary，且 `uploaded: 1`。修正後外部 HTTP boundary request 精確符合原確認，conflict 只呼叫一次；move 不 upload／delete。舊 fallback expectation 與 mount tree expectation 調整放在獨立 test-only commit `a9596f4`。

| 驗證 | 結果 |
| --- | --- |
| `npm run sync-spec && npm run generate` | 成功，產物已 commit；未將 candidate OpenAPI 冒充 live snapshot |
| `npm run typecheck` | 通過 |
| `npm test` | 65 files、746 tests 通過 |
| `npm run build` | 通過 |
| `npm pack --dry-run` | 通過，10 個發布檔案 |
| `git diff --check` | 通過 |

## Candidate 實際 command 驗收

環境：Node 26.8.1，local `wrangler dev`＋8780 proxy，CLI build 的 `dist/cli.js`。使用既有本機 acceptance credential；只暫時選取 local environment，finally 恢復原 environment，未輸出 token。呼叫實際 CLI process，未 mock auth、SDK、network 或 sync modules。低敏結果：[candidate-evidence.json](candidate-evidence.json)。

| 操作 | 結果 |
| --- | --- |
| `drive file rm` 缺 entry ID | exit 1，未刪除 |
| `drive file rm` 原 ID／path／版本 | exit 0，同 identity tombstone |
| `drive file rm` 重送 active 舊版本 | exit 1，VERSION_CONFLICT |
| `drive bind`、本機建立檔案、`drive sync once` | upload 1，state 保存原 ID |
| 本機 rename、`drive sync once` | move 保留原 ID，版本 +1 |
| 本機移除、`drive sync once` | delete 1 |
| A 原版本 2，A 移走、B 以版本 2 移入，再 sync 刪除 | exit 1、deleted 0，state 保留 A ID，manifest 保留 B ID |
| 移除 state 的 entry ID 後 sync | exit 1，state 完整不變；unit test 證明不先 fetch manifest |
| Cleanup | 專用檔案／Library soft-delete，active count／bytes 0，未 purge |

## Review 與尚待驗收

Repository standards review：重用 SDK／auth／consistency fetch 與 Commander，generated output 由 live snapshot 重新 generate，無 dependency／workflow 變更。Spec review：原 confirmation propagation、no fallback／no fresh retry、legacy state refusal 均有測試與 candidate readback。Ponytail review：刪除 move fallback，沒有新增 generic framework；handwritten rm 是先發布相容 caller 所需的邊界。

本報告尚不是正式 package 的證據。待 CLI exact-head CI、merge、minor release workflow、npm registry readback 後，以已發布 package 重跑相同 candidate 驗收，將結果記錄於同目錄 `release.md`。Backend #1237 在取得這些證據前不可 merge。Live required fields 與 backend production 驗收之前，不宣稱 server 已提供 identity 保護。

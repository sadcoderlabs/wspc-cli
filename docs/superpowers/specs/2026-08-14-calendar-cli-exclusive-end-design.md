# Calendar CLI mutation Exclusive End 設計

對應產品目標：WSPC Todo `tod_01M006KX9VBKKM8Y43SNNJZM4T`

## Problem Statement

Calendar REST、RPC、MCP、D1 與 ICS 已統一使用半開區間 `[start, end)`。對 all-day Event 而言，`start` 與 `end` 都是 Calendar Date，`end` 是第一個不屬於 Event 的 **Exclusive End**。例如只涵蓋 2026-05-10 的 Event，其 wire contract 是 `start=2026-05-10`、`end=2026-05-11`。

截至 `@wspc/cli` v0.6.0，CLI mutation 卻仍有兩種邊界語意。`event add --all-day` 與 `event set --all-day` 將使用者輸入的 `--end` 當成 Inclusive End，經 `inclusiveEndToExclusive()` 暗中加一天後才送到 API；v0.6.0 新增的 `event occurrence set` 則已直接要求 Exclusive End。相同的 `--end` flag 因 command 不同而有不同意義，輸入也無法與 JSON、pretty response 或後續 `event show` 直接 round-trip。

目前 source of truth 亦互相矛盾。Production OpenAPI 的 Event schema、operation description 與 request example 已描述 RFC 5545 Exclusive End，但 `event add`／`event set` 的 `x-cli.options.end.exclusive=true` 仍指示 codegen 執行 `end + 1 day`；`event add` 的 `x-cli` example 與 [wspc.ai CLI reference](https://wspc.ai/cli/) 仍示範 Inclusive End。`wspc-cli` 的 committed OpenAPI snapshot、generated commands、codegen tests 與 generated command tests因此保留舊行為。

這是公開 CLI contract 的 breaking change，不是 Calendar data migration。既有 Event 已以 Exclusive End 正確儲存，不需改寫 D1、REST payload、RPC、MCP 或 ICS；只有升級 CLI 後的 mutation input interpretation 改變。

## Solution

所有 Calendar CLI mutation 統一採 Exclusive End：`end` 永遠是第一個不屬於 Event 或 Occurrence 的日期或時間。

- `wspc event add --all-day` 將 `--end` 驗證為 ISO date-only 後原樣送出。
- `wspc event set --all-day` 對有提供的 `--start`／`--end` 各自驗證並原樣送出；partial update 不補值、不加一天。
- `wspc event occurrence set` 維持 v0.6.0 已有的 Series-aware parsing 與 Exclusive End，不新增第二套轉換。
- Timed Event 與 timed Occurrence 維持既有 `[start, end)`、offset、UTC 與 Series Time Zone 行為。

一日 all-day Event 使用：

```bash
wspc event add "Holiday" --all-day \
  --start 2026-05-10 \
  --end 2026-05-11
```

涵蓋 2026-10-25、26、27 三個 Calendar Dates 的 Event 使用：

```bash
wspc event add "Offsite" --all-day \
  --start 2026-10-25 \
  --end 2026-10-28
```

不提供 legacy flag、compatibility mode、環境變數、自動 Inclusive End 偵測或 warning-only 過渡期。v0.6.0 的舊 script 必須把原本「最後一個包含日期」的 `--end` 加一天，才能在新版本維持相同涵蓋範圍。`start == end` 不再因 CLI 暗中加一天而成功；API 固定回 `VALIDATION_ERROR`，CLI 沿用現有 error rendering fail loudly。

目前 release baseline 是 v0.6.0，因此本行為由 v0.7.0 發布。若 v0.7.0 前另有 minor release，則改由當時下一個 minor 發布；不得混入 patch release。GitHub release notes 必須明列 breaking behavior，並同時提供 v0.6 與新版本的一日、跨多日 before／after examples。

## User Stories

1. 作為使用 CLI 建立 all-day Event 的使用者，我輸入的 `start`／`end` 與 API response 完全相同，不需記住 CLI 會替我改日期。
2. 作為更新既有 Event 的使用者，我可只提供 `--end` 或只提供 `--start`，未提供的 boundary 保持不變，已提供的 Calendar Date 不被暗中調整。
3. 作為管理 Recurring Series 的使用者，我在 Series Master 與單一 Occurrence mutation 使用同一套 Exclusive End 語意。
4. 作為 script author，我可用一致的 `[start, end)` contract 組合 REST payload、CLI command 與後續 response，不需按 command path 分支。
5. 作為從 v0.6 升級的 operator，我能從 help、網站文件與 release notes 看到可執行的 migration examples，而不是在 production 才發現 Event 少一天。
6. 作為 maintainer，我只維護 ISO date-only validation，不保留未被 wire contract 使用的 Inclusive End conversion abstraction。

## Implementation Decisions

### Public contract and failure handling

`--all-day` 時，`event add` 與 `event set` 的 `--start`、`--end` 都只接受合法 `YYYY-MM-DD`。格式或日曆值無效時沿用 `parseDateOnly()` 與 `ParseDateError`，在送 request 前失敗。CLI 不比較 start/end，也不複製 Calendar validation；合法 date-only 但 `end <= start`、boundary kind mismatch 或其他 domain validation 由既有 Calendar API 回 HTTP 400 `VALIDATION_ERROR`。

`event set --all-day` 的 PATCH semantics 不變。省略 `--start` 或 `--end` 就不送該欄位；只提供 `--end 2026-05-11` 時 request body 的 `end` 必須精確等於 `2026-05-11`。CLI 不讀取 Event 來補 boundary，也不根據 response 推測使用者原本想表達 Inclusive End。

`event occurrence set` 已在 v0.6.0 先讀 Series Master，再依 all-day、UTC 或 canonical Series Time Zone 解析 required `--start`／`--end`。All-day path 已原樣保留 date-only Exclusive End；這次只加 regression coverage，不改其 Recurrence ID、Exception Version、parse-only `--tz`、CAS 或 Occurrence Exception contract。

JSON、pretty output、SDK public types與 API schemas繼續回傳 raw Exclusive End。不得新增 inclusive display、改欄位名稱或讓 pretty 與 JSON 使用不同 boundary。

### Source ownership and generated boundary

OpenAPI `x-cli` metadata 的 canonical source 位於 private `sadcoderlabs/wspc` repository 的 `packages/calendar/worker/src/routes/events.routes.ts`。Implementation 必須先在該 source 移除 `event add` 與 `event set` 的 `end.exclusive=true`，並把 all-day CLI examples 改為 Exclusive End；不得直接手改 `wspc-cli/spec/openapi.json`。

`wspc-cli` 在 production OpenAPI 更新後執行 `npm run sync-spec` 與 `npm run generate`。Codegen 對所有帶 `parser: "datetime"` 與 `allDayFlag` 的 boundaries 一律呼叫 `parseDateOnly()`，不再辨識 `XCliOption.exclusive`。Production metadata 不再有 caller 後，刪除 `exclusive` option、`usesInclusiveEndToExclusive` branch、generated imports、`inclusiveEndToExclusive()` helper 及只為它存在的 tests；不保留 speculative conversion hook。`src/generated/` 只由 OpenAPI／codegen regenerate，不手改。

Upstream `sadcoderlabs/wspc` 同一個 implementation change 必須更新 `packages/landing/src/content/docs/cli.md` 與 `packages/landing/public/AGENTS.md` 的 all-day examples和語意，並依 `.claude/rules/cli-docs-drift.md` 重新核對 command path與flags。API schema descriptions與 wire examples 本來已是 Exclusive End，只修正仍描述 Inclusive End 的 CLI-specific內容。

### Versioning and migration

這是 pre-1.0 minor breaking release。以目前 baseline 計，release workflow 使用 `bump=minor` 產生 v0.7.0。Implementation PR title與 GitHub release notes都必須標示 breaking Calendar CLI behavior；generated release notes若未保留 migration examples，operator 必須在宣告 acceptance 前補寫 release body。

沒有 server data、config、token 或 credential migration。舊 script migration是純輸入調整：

| 涵蓋範圍 | v0.6 input | v0.7+ input |
| --- | --- | --- |
| 2026-05-10 一日 | `--start 2026-05-10 --end 2026-05-10` | `--start 2026-05-10 --end 2026-05-11` |
| 2026-05-10 至 2026-05-12 | `--start 2026-05-10 --end 2026-05-12` | `--start 2026-05-10 --end 2026-05-13` |

### Rollout and rollback

Rollout 固定為：先在 `sadcoderlabs/wspc` merge metadata與 docs change並部署 production OpenAPI；緊接著在 `wspc-cli` sync snapshot、regenerate、merge implementation PR；執行 minor release dry-run並檢查 packed help／examples；publish npm minor；最後驗證 `@wspc/cli@latest`、production OpenAPI、wspc.ai CLI reference與 live Calendar canary。Upstream docs在轉換窗口應明列適用版本，且窗口不得跨過下一次正常 release cycle。

Publish 前任一 gate 失敗就停止 rollout，不發布 npm。Publish 後若發現一般 implementation regression，以維持 Exclusive End contract 的 patch修正；不得把 `latest` 靜默退回 Inclusive End、在 patch中反轉語意或恢復雙模式。只有新的產品決策才可在後續 minor重新改變 boundary contract，並需新的 migration notes。既有 Calendar資料不需 rollback。

### External inventory

| 資源 | 環境與身份 | Credential／保存位置 | Implementation mutation | 驗證 |
| --- | --- | --- | --- | --- |
| `sadcoderlabs/wspc` OpenAPI與 landing docs | GitHub private repo、Cloudflare production；既有 maintainer／deploy identity | GitHub與Cloudflare既有 credential；Keychain／GitHub Actions secrets，絕不寫入 repo、Todo或報告 | 修改 Calendar `x-cli` metadata、CLI docs source並部署 | Live OpenAPI無 `end.exclusive`、public CLI reference只描述 Exclusive End、repo CI成功 |
| `sadcoderlabs/wspc-cli` | GitHub public repo；既有 maintainer identity | GitHub CLI keyring credential | 修改 codegen／handwritten source／tests，sync並 regenerate committed artifacts | Exact-head PR CI、generated drift為零、packed CLI help與request tests |
| npm `@wspc/cli` | npm production registry；GitHub Actions Trusted Publishing | OIDC臨時credential，由 release workflow取得；不保存 npm token | 以 `.github/workflows/release.yml` 發布下一個 minor | npm version、provenance、`npx @latest --version`與 help |
| Production Calendar canary | 既有受控 WSPC acceptance account | Published CLI login，credential留在使用者 config／Keychain | 建立或重用目標 all-day single Event、Recurring Series及 Occurrence；只改測試資料 | Request／response boundary相同、Google／ICS涵蓋日期正確、清理目標資料 |
| WSPC Todo | Production `wspc-cli` project | Published CLI既有 login；credential留在使用者 config／Keychain | Spec merge後將產品目標 Todo 原地更新為 implementation handoff | Read-back project、root、open、六章、`blob/main` URL與 `ready-for-agent` tag |

不建立新 external service、account、database、sender identity、token、secret、timezone resource或 operator Web UI。Spec publication workflow只記錄上述 future implementation mutations；除 GitHub spec PR／merge與既有 Todo handoff外，不執行它們。

### Documentation publication decision

本 spec 是 `wspc-cli` implementation 的 source of truth，README Roadmap連到本檔。Server Calendar Recurrence M4 spec仍治理 Occurrence Exception本身；本 spec只治理外部 CLI boundary，不重寫 M4。這項變更是 pre-1.0 input contract simplification，容易透過新 minor重新決策，沒有新的 storage或 architecture trade-off，因此不新增 ADR。

## Testing Decisions

Implementation 先以 TDD 把現況鎖成失敗：codegen測試期待 all-day `end` 使用 `parseDateOnly()` 且 generated code不含 `inclusiveEndToExclusive`；generated command tests期待 `event add`、`event set` 原樣送出 Exclusive End。確認這些 tests在 v0.6 baseline失敗後才修改 production source。

Focused coverage至少包含：

- `event add --all-day --start 2026-05-10 --end 2026-05-11` request與 response都保持兩個原始 Calendar Dates。
- 跨月與 leap-day Exclusive End只驗證、不做日期數學。
- all-day Recurring Series建立時 `start`／`end`原樣送出，RRULE與 Series Time Zone rules不變。
- `event set --all-day` 同時更新兩個 boundaries、只更新 `start`、只更新 `end`時均不補值或加一天。
- `start == end`、`end < start`與 kind mismatch經 API固定為 `VALIDATION_ERROR`；invalid date-only在本機固定為 `ParseDateError`。
- Timed single Event、UTC Recurring Series、local Series Time Zone、DST gap／overlap、attendee replacement與 optimistic version沒有 regression。
- `event occurrence set` 的 all-day、UTC與 local Series tests保持 Exclusive End、required start/end、parse-only `--tz`及 Exception Version行為。
- `rg "inclusiveEndToExclusive|exclusive: true"` 在 production source、tests與 generated code沒有 runtime／metadata caller；歷史 spec文字可保留為 migration脈絡。
- Generated help、README、upstream `AGENTS.md`、wspc.ai CLI reference與 GitHub release notes都使用同一組一日／多日 examples。

`wspc-cli` 必跑完整 release-equivalent pipeline：

```bash
npm run sync-spec
npm run generate
npm run typecheck
env -u NO_COLOR TERM=xterm-256color npm test
npm run build
npm pack --dry-run
git diff --check
```

PR CI 必須在 exact implementation head成功，`npm run generate`後 `src/generated/`不得產生 drift。Upstream `sadcoderlabs/wspc` 另跑其 Calendar route metadata／docs drift focused tests、typecheck、unit／integration tests、build、formatter與 `git diff --check`。

Production acceptance使用 published minor而非 local source：至少建立一個一日 all-day Event、一個三日 all-day Event與一個 all-day Recurring Series，並對其中一個 Occurrence改期。逐筆保存低敏 evidence：CLI version、command shape、public Event／Series／Recurrence ids、request與 response boundaries、HTTP outcome、ICS涵蓋日期及 deploy／release SHA；不得保存 token、raw headers、完整 email、raw ICS或 credential。`start == end` canary必須回 `VALIDATION_ERROR`且不建立 Event。Acceptance完成後清理專用測試資料。

Spec-only PR本身不執行產品 tests；驗證六個頂層章節、README link、glossary格式與 `git diff --check`即可。

## Out of Scope

- 不修改 Calendar REST、RPC、MCP、D1、ICS或 Event／Occurrence DTO的 `[start, end)` contract。
- 不修改既有 Event資料，不新增 migration、backfill、dual-write或 server compatibility field。
- 不改 `event occurrences --from/--to`、`event agenda --from/--to` 的半開 query window。
- 不改 `event ls --to`、`--start-to`、`--end-to` 等目前仍為 inclusive 的 query filters；它們不是 mutation boundaries，另行決策。
- 不新增 Inclusive End display、第二組 flag、自動偵測、warning mode、config或 environment toggle。
- 不改 Relative Time、Calendar Date output、RRULE、Series Time Zone、attendees、Occurrence Exception、Exception Version或 Recurrence ID semantics。
- 不實作產品變更、發布 npm、部署 server／landing docs或執行 production Calendar canary；這些由 spec merge後仍保持 open的 implementation Todo交付。

# 移除未使用的 occurrence-time-zone parser marker

## Problem Statement

CLI／Calendar 維護者目前需要理解沒有專屬行為的 `occurrence-time-zone` parser variant。2026-09-09 查核 [canonical Calendar route](https://github.com/sadcoderlabs/wspc/blob/main/packages/calendar/worker/src/routes/events.routes.ts) 與 [production OpenAPI](https://api.wspc.ai/openapi.json)，`event_occurrence_set` 都宣告 `tz: { parser: "occurrence-time-zone", requestOnly: true }`。CLI 的 `XCliOption.parser` union 與 codegen fixture 也保留這個名稱，但 emitter 沒有對應 branch。

實際上，`--tz` 由一般 virtual option 邏輯產生；`start`／`end` 的 `occurrence-time` marker 才觸發 Series Master 讀取與 `parseOccurrenceMutationTimes(..., opts.tz)`。維護者無法從 marker 名稱得知這個差別。最小里程碑是清除兩端多餘 contract，讓既有使用者命令與行為完全不變；沒有已證實的 runtime bug 或效能問題。

Source 分屬 private `sadcoderlabs/wspc` 與 `sadcoderlabs/wspc-cli`，後者使用 production OpenAPI snapshot 產生 SDK／CLI。既有 [Exclusive End spec](2026-08-14-calendar-cli-exclusive-end-design.md) 與 root `CONTEXT.md` 的 Calendar Date、Occurrence、Series Master、Recurrence ID 契約持續適用。

## Solution

從 canonical metadata 移除 `tz.parser`，保留 `tz: { requestOnly: true }`；CLI 移除對應 parser union member，fixture 改用沒有 parser 的普通 `tz` option。保留 `start`／`end` 的 `occurrence-time` marker。

公開行為保持一致：

- `event occurrence set <series_id> <recurrence_id>` 仍要求 `--start` 與 `--end`，僅有一個 optional `--tz <value>`，help、輸出及錯誤呈現不變。
- 仍先讀 Series Master，成功才解析並提交 mutation；讀取失敗不送 mutation。Body 仍只有既有 `start`、`end`、optional `expected_version`，`tz` 不進入 body／query；path 與 immutable Recurrence ID 不變。
- All-day 使用合法 Calendar Date，原樣保留 Exclusive End；任何明確提供的 `--tz` 都拒絕。Timed Series 依 Series Time Zone 解析，缺少 Series Time Zone 時使用 UTC；明確提供的 `--tz` 必須與之相同。省略 `--tz` 不改用 `WSPC_TZ` 或本機時區。
- 不改既有日期錯誤、認證、權限、版本衝突、等待期間或空結果行為。`requestOnly` 是獨立 metadata，保留而不重新定義。

## Acceptance Criteria

1. **移除 contract 殘留。** Upstream source、已部署 production `event_occurrence_set.x-cli.options.tz` 與 sync 後 snapshot 都不含 `parser`，仍為 `{ requestOnly: true }`；CLI parser union 不含 `occurrence-time-zone`。實作前／後以 upstream route 或 OpenAPI contract test 自動驗證，預期先因 marker 仍存在而失敗、修改後成功。Upstream merge／deploy 後以 live GET 保存 operation metadata 與 deploy SHA；CLI merge 後確認 main snapshot 相同。
2. **命令介面不變。** 同一個 OpenAPI baseline 只移除 marker 時，舊／新 emitter 產生相同 command source；build 後 `event occurrence set --help` 相同，`--tz <value>` 恰好一次。既有 required `--start`／`--end` 缺值時仍由 Commander 拒絕。CLI PR 前以 codegen tests、command tests 與 binary help 比對，保存結果。
3. **Request 不變。** 使用 mock SDK 與固定 Series Master 的 generated command tests，驗證先 GET 再 mutation、相同 path／body、`expected_version` 保留、沒有 `tz` body／query；GET 失敗不送 mutation。CLI PR 前及 CI 自動執行。無須對 production Calendar 寫入測試資料。
4. **時間與錯誤邊界不變。** 自動 tests 覆蓋合法 all-day `2028-02-29` 到 `2028-03-01` 原樣送出、無效 `2026-02-29` 拒絕、all-day 加 `--tz UTC` 拒絕；timed `Asia/Taipei` 同 zone 接受、`UTC` hint 不同則拒絕；沒有 Series Time Zone 時以 UTC 輸出。省略 hint 即使環境 `WSPC_TZ` 不同也依 Series Master。有效 offset 輸入的 Instant 不變。於 CLI PR 前及 CI 執行，保持既有 error class／訊息。
5. **可重現交付。** Upstream 部署完成後才 sync／generate，CLI typecheck、完整 tests、build 成功；再次 generate 對已準備提交的 `src/generated/` 無差異。兩個 repo 的 implementation PR 使用正常 CI gates。CLI merge 後從 main 驗證 generated zero drift 並保存兩端 merge SHA、deploy/live evidence 與檢查結果。不能以 spec merge、僅刪除 union 或尚未部署的 source 宣告實作完成。

## Implementation Decisions

主要修改點為 upstream `packages/calendar/worker/src/routes/events.routes.ts` 的 `updateOccurrenceRoute`，以及 CLI `tools/cli-codegen/emit.ts`、`tools/cli-codegen/emit.test.ts`。沿用一般 virtual option emission 與 `parseOccurrenceMutationTimes`，不新增 branch、adapter 或相容層。`requestOnly` 保留於 upstream 與 snapshot，不為此向 emitter 加入新欄位。

執行順序為 upstream contract test red → metadata 修改 → upstream tests／merge／既有 production deploy → 確認 live metadata → CLI union／fixture 調整 → `npm run sync-spec` → `npm run generate` → CLI 驗證／merge → main readback。Generated 內容只由 pipeline 更新。

開始 implementation 前，比較 upstream main、live OpenAPI 與 CLI snapshot。查核時 live description 已有本機 snapshot 尚未包含的通知說明。若有無關 drift，先透過獨立同步變更建立共同 baseline 並完成其適用驗證，再處理本 marker；不得手改 snapshot 去消除 drift，也不能把無關 description／help 差異當作 marker 移除的預期結果。驗收條件 2 比較的是同一 baseline 下的 marker-only 差異。

無資料或 credential migration，不新增 dependency 或資源。交付至兩端 main、production metadata 與可重現 CLI artifacts 即完成；npm package 隨下一次正常 release 發布。任一部署或驗證失敗就停止後續交付並保留未完成狀態。若需 rollback，以原 repo 的 revert 恢復 metadata／union／fixture 並重新部署／generate；marker 本來不影響舊、新 CLI runtime，不需要 Calendar data rollback。

| 外部資源 | 環境、身份與 credential 位置 | 執行路徑與驗證 |
| --- | --- | --- |
| GitHub 兩個 repositories | 既有 maintainer；GitHub plugin connection 或 authenticated `gh` 的 OS credential store。Private repo 已確認可讀與 push，production deploy 權限仍須實作時確認。 | 透過 GitHub plugin review／merge，正常 CI；讀回 merge SHA。 |
| Calendar production OpenAPI | `sadcoderlabs/wspc` 既有 GitHub Actions deploy identity；`CLOUDFLARE_API_TOKEN` 在 Actions secrets，`CLOUDFLARE_ACCOUNT_ID` 在 Actions variables。 | 使用 upstream `.github/workflows/deploy.yml` 的正常 main deployment；讀取 workflow logs 與 `https://api.wspc.ai/openapi.json`。若既有 identity 缺失，由 operator 依 upstream `DEVELOPER.md` Deploy & Operator Runbook 恢復，不自行新建 token／帳號或繞過 deploy gates。 |
| CLI snapshot | 本機與 CI Node.js 24+；公開 OpenAPI GET 無需 credential。 | `npm run sync-spec`、`npm run generate`，檢查 metadata 與 zero drift。 |

本 spec 記錄後續 implementation 所需的部署與權限，不執行 setup，也不保存真實 credentials。

## Testing Decisions

AC1 使用 upstream 現有 route／OpenAPI test seam，先加入「`tz` 只含 `requestOnly`」assertion，記錄 red／green。CLI plain `tz` fixture 本來就應可運作，因此不虛構 runtime failure；刪除 union member 後 fixture 仍使用舊 marker 時的 type error 只是編譯檢查，不替代 upstream red evidence。

AC2 沿用 `tools/cli-codegen/emit.test.ts`，驗證普通 `tz` option、一次 flag、master fetch 與 parser argument；保存 marker-only source／binary help 比對。AC3 沿用 `test/generated/event.test.ts` 的 SDK mock boundary。AC4 沿用 `test/handwritten/utils.test.ts` 與 generated event tests；只補現有 coverage 缺口，不複製 parser implementation。

CLI pre-merge 執行 `npm run typecheck`、`env -u NO_COLOR TERM=xterm-256color npm test`、`npm run build`、`git diff --check` 與 AC5 的 regeneration drift check；upstream 使用該 repo Calendar／OpenAPI 適用 tests 與正常 CI。Post-merge 保存 AC1、AC5 readbacks。只需 live OpenAPI 唯讀驗證，因這是 metadata 清理且 request seam 可自動驗證，不要求 production Calendar canary 或新測試 framework。

## Out of Scope

不改 Calendar parsing、Series Time Zone 政策、Exclusive End、Recurrence ID、Occurrence Exception Version、API request schema、通知規則、其他 parser variants 或 `requestOnly`。這些僅在另有獨立產品需求與規格時重訪。

不新增 UI、設定、相容層、依賴、資料遷移或 production Calendar 測試寫入。不要求專屬 npm release；下一次正常 release 自然帶入 snapshot。無關 OpenAPI drift 依 Implementation Decisions 獨立處理，不夾帶在本清理之中。

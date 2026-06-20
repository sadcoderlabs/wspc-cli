# wspc-cli 開發指引

這份文件是 repo current-practice source of truth。開始任何開發或 brainstorming 前，先讀本文件的 Tech Stack / Repo Layout、Architecture & Coding Conventions、Testing & Quality Gates、Agent / API Surface、Deploy & Operator Runbook；若有相關 spec，先讀 `docs/superpowers/specs/`，spec 與實作不一致時先更新 spec，再改實作。

## Tech Stack / Repo Layout

- Runtime：Node.js 24+，package 是 ESM。
- 語言：TypeScript strict mode，`noUncheckedIndexedAccess` 開啟。
- CLI framework：`commander`。
- OpenAPI SDK：`@hey-api/openapi-ts` 由 `spec/openapi.json` 產生 `src/generated/sdk/`。
- CLI codegen：`tools/cli-codegen/` 讀 OpenAPI 的 `x-cli` metadata，產生 `src/generated/cli/`。
- Build：`tsup` 產生 `dist/index.js` 和 `dist/cli.js`，target 是 `node24`。
- Test：Vitest。

主要目錄：

- `src/cli.ts`：CLI 入口，掛載 generated commands 與少量 handwritten commands。
- `src/index.ts`：SDK/library export 入口。
- `src/generated/`：產物；不要手改。修 generator、OpenAPI spec 或 handwritten layer。
- `src/handwritten/`：auth、config、output renderer、特殊 CLI command、parser / formatter helper。
- `tools/cli-codegen/`：產生 CLI command 的 generator。
- `scripts/sync-spec.ts`：從 `https://api.wspc.ai/openapi.json` 更新 `spec/openapi.json` 與 `src/version.ts`。
- `scripts/build-version.ts`：從本機 `spec/openapi.json` 產生 gitignored 的 `src/version.ts`，供 fresh clone / CI / install 使用。
- `test/`：Vitest tests，依功能區分 generated、handwritten、auth/config/output/codegen。

## Architecture & Coding Conventions

- 一般 API command 走 OpenAPI `x-cli` -> `tools/cli-codegen` -> `src/generated/cli/`。不要直接修改 generated command。
- 新增或修正 command shape 時，優先改 API OpenAPI metadata 或 `tools/cli-codegen/`。只有 codegen 不該理解的行為才放 handwritten command。
- Handwritten command 用在行為特殊的 case，例如 login/logout/whoami/config/account、`todo done` sugar、email attachment / binary download / multipart-like encoding。
- CLI command 需要 authenticated API 時，使用 `loadSdkClient()`；需要 raw authed fetch 時，使用 `loadAuthedFetch()`。
- 所有 WSPC API request 應經過 `createConsistencyFetch()`，讓 consistency bookmark header 注入、回寫與 invalid cleanup 保持一致。
- `createConsistencyFetch()` 是 consistency bookmark 的共享邊界：對 `apiBase` 內 request 注入已儲存 bookmark，對 `apiBase` 外 request 移除已知 bookmark header。
- `INVALID_CONSISTENCY_BOOKMARK` 清理時不 retry，直接回傳原錯誤；清理必須 value-exact，只刪除仍等於本次注入值的 bookmark，避免覆蓋並行 request 寫入的新值。
- `ConfigStore.update()` 以檔案 lock 做 read-modify-write；修改 config、token refresh、bookmark 寫回時不要繞過它。
- CLI output 預設 TTY pretty、pipe / redirect JSON；`--json` 與 `WSPC_OUTPUT=json|pretty` 可強制模式。機器可讀輸出不要依賴 pretty renderer。
- Pretty output 走 `src/handwritten/output/render.ts`，優先用 spec display hints；需要特殊顯示時再註冊 specific renderer。
- 時間 / 日期 / 時區處理使用 Luxon `DateTime`。`Date.now()` 取 Unix ms 合法；使用者語意時間用 ISO 8601 + offset，全天事件用 ISO date-only。
- 註解只寫必要的 why。程式碼、註解、commit message、issue/PR 標題、log 訊息字串用英文。
- 文件以繁體中文為主，HTTP、RPC、TDD、worker、binding、OpenAPI、SDK、CLI 等技術術語保留英文。

## Testing & Quality Gates

開發功能先走 TDD：先補失敗測試，確認失敗，再實作。純文件更新不需要測試，但仍跑 `git diff --check`。

常用指令：

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

OpenAPI / generated output 相關改動使用完整 pipeline：

```bash
npm run sync-spec
npm run generate
npm run typecheck
env -u NO_COLOR TERM=xterm-256color npm test
npm run build
```

測試慣例：

- Helper / parser / renderer 直接 unit test。
- CLI command test 優先 mock generated SDK 與 auth loader，檢查 body、exitCode、stderr、render call。
- 需要 config 狀態時使用 temp dir 建 `ConfigStore`，不要碰使用者真實 `~/.wspc/config.json`。
- CLI binary smoke test 可先 `npm run build`，再用 `node ./dist/cli.js ...`。
- Output snapshot 類測試若受 ANSI 影響，使用 `env -u NO_COLOR TERM=xterm-256color npm test` 重現 pretty path。

## Agent / API Surface

- Package export 是 `src/index.ts`，目前公開 `WspcClient`、auth error、version/spec metadata 與少量 resource wrapper。
- CLI binary 是 `wspc`，npm package 是 `@wspc/cli`。
- `--account` 的優先序高於 `WSPC_ACCOUNT`，再高於 active account；此規則由 `src/cli.ts` preAction 寫入 env 後由 `resolveAccount()` 處理。
- `src/version.ts` 是 generated 且 gitignored；不要 commit。它由 `npm run prepare` 或 `npm run sync-spec` 產生。
- `spec/openapi.json` 是 committed API contract snapshot；更新 live API 命令前先 `npm run sync-spec`，再 `npm run generate`。
- `src/generated/sdk/` 和 `src/generated/cli/` 都是 committed generated output；更新 generator/spec 後要一併提交 regenerated diff。
- README 是使用者入口，DEVELOPER 是開發者與 agent 入口，docs/superpowers/specs 與 plans 保留設計與實作拆解脈絡。

## Deploy & Operator Runbook

這個 repo 沒有服務端 deploy pipeline；交付面是 npm package publish。不要把它當 Worker / backend repo 操作。

Release / publish 前至少確認：

```bash
npm run sync-spec
npm run generate
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

注意事項：

- `prepublishOnly` 會跑 `npm run sync-spec && npm run build`，publish 時會碰 live `https://api.wspc.ai/openapi.json`。
- 如果 release 不應更新 API snapshot，不要直接 publish；先釐清 spec drift。
- `npm run prepare` 會重建 `src/version.ts`，這是預期行為，該檔仍然不要 commit。
- 文件 / spec-only PR 標題加 `[skip deploy]`；程式碼、workflow、API surface 或 generated output 變更不要使用這個旗標。
- 不要用 `--no-verify` / `--no-gpg-sign` 跳過驗證，先修根本問題。
- 不要 amend 已 push 的 commit；不要 `git push --force` 到 `main` / `master`，除非先取得明確同意。
- Commit message 用 conventional format，例如 `feat(cli): ...`、`fix(auth): ...`、`docs(dev): ...`。
- 不要加入 AI co-author trailer。

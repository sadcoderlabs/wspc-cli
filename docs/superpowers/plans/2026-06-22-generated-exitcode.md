# Generated exitOnField exitCode 實作計畫

> **給 agentic workers：** 必要 sub-skill：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤。

**目標：** 讓 generated `exitOnField` command 設定 `process.exitCode = 1`，不再強制 `process.exit(1)`。

**架構：** 修改 codegen test 與 generated command test 先形成 RED，再把 generator emission 從 `process.exit(1)` 改成 `process.exitCode = 1`。Generated runtime 檔案只透過 `npm run generate` 更新，不手改。

**技術棧：** TypeScript、Vitest、repo 既有 CLI codegen。

---

### Task 1: Codegen test 與 generator

**檔案：**
- 修改：`tools/cli-codegen/emit.test.ts`
- 修改：`tools/cli-codegen/emit.ts`

- [ ] **Step 1: 寫出失敗的 generator test**

把 `exitOnField` 相關 expectation 從 `process.exit(1)` 改成 `process.exitCode = 1`。

- [ ] **Step 2: 驗證 RED**

執行：`npm test -- tools/cli-codegen/emit.test.ts test/generated/push.test.ts`
預期：generator test 會因 emitted code 仍是 `process.exit(1)` 而失敗。

- [ ] **Step 3: 實作最小 generator 變更**

在 `tools/cli-codegen/emit.ts` 只把 emitted line 改成 ``process.exitCode = 1``，不新增 helper，不改其他 error handling。

- [ ] **Step 4: 驗證 GREEN**

執行：`npm test -- tools/cli-codegen/emit.test.ts`
預期：codegen tests 通過。

### Task 2: Generated output 與 runtime test

**檔案：**
- 修改：`test/generated/push.test.ts`
- 產生：`src/generated/cli/push/test.ts`
- 修改：`docs/improve/README.md`

- [ ] **Step 1: 更新 runtime test**

把 `process.exit` spy 改成檢查 `process.exitCode`，並在測試後清回 `undefined`。

- [ ] **Step 2: Regenerate**

執行：`npm run generate`
預期：generated CLI runtime 只出現 exitOnField 相關 mechanical diff。

- [ ] **Step 3: Sweep forced exit**

執行：`rg -n "process\\.exit\\(1\\)" src/generated/cli tools/cli-codegen/emit.ts test/generated/push.test.ts`
預期：沒有 generated runtime 或本次範圍內的 match。

- [ ] **Step 4: 標記 improve plan 完成**

把 `docs/improve/README.md` 內 plan 003 的狀態從 `TODO` 改成 `DONE`。

- [ ] **Step 5: 最終檢查**

執行：

```bash
npm test -- tools/cli-codegen/emit.test.ts test/generated/push.test.ts
npm run typecheck
git diff --check
env -u NO_COLOR FORCE_COLOR=1 npm test
```

預期：所有 commands 都以 0 結束。

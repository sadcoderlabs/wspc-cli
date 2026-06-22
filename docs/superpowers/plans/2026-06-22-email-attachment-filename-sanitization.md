# Email attachment 檔名清理實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 response header 產生的預設 attachment 檔名寫到目前目錄以外。

**Architecture:** 只收緊 `Content-Disposition` filename parser：安全 token 直接回傳，不安全 token 回傳 `undefined`，讓現有 fallback 檔名接手。`--output` 是使用者明確指定的路徑，行為不變。

**Tech Stack:** TypeScript、Node fs/path primitive、Vitest。

---

### Task 1: Header filename parser 安全性

**Files:**
- Modify: `test/handwritten/parse-content-disposition.test.ts`
- Modify: `src/handwritten/utils/parse-content-disposition.ts`

- [ ] **Step 1: 寫出失敗的 parser 測試**

新增測試案例，證明 slash、backslash、`.` 與 `..` 都回傳 `undefined`，但 `invoice.pdf` 仍正常回傳。

- [ ] **Step 2: 驗證 RED**

執行：`npm test -- test/handwritten/parse-content-disposition.test.ts`
預期：實作前 unsafe filename cases 會失敗。

- [ ] **Step 3: 實作最小 parser 拒絕規則**

沿用既有 token 擷取邏輯，擷取後拒絕空檔名、`/`、`\`、`.` 與 `..`。不要新增 dependency，也不要加入 RFC 5987 支援。

- [ ] **Step 4: 驗證 GREEN**

執行：`npm test -- test/handwritten/parse-content-disposition.test.ts`
預期：所有 parser tests 通過。

### Task 2: Attachment command fallback 行為

**Files:**
- Modify: `test/handwritten/email-attachment.test.ts`
- Verify: `src/handwritten/commands/email/attachment.ts`
- Modify: `docs/improve/README.md`

- [ ] **Step 1: 寫出失敗的 command 測試**

新增一個 integration test，讓 header filename 是 `../escape.txt`；確認 fallback `<emailId>-<idx>.bin` 會建立在 temp dir 內，而且 parent escape file 不會被建立。

- [ ] **Step 2: 搭配 parser 變更驗證 RED/GREEN**

執行：`npm test -- test/handwritten/parse-content-disposition.test.ts test/handwritten/email-attachment.test.ts`
預期：command 使用 parser fallback，Task 1 後 focused tests 通過。

- [ ] **Step 3: 標記 improve plan 完成**

把 `docs/improve/README.md` 內 plan 002 的狀態從 `TODO` 改成 `DONE`。

- [ ] **Step 4: 最終檢查**

執行：

```bash
npm run typecheck
git diff --check
npm test -- test/handwritten/parse-content-disposition.test.ts test/handwritten/email-attachment.test.ts
npm test
```

預期：所有 commands 都以 0 結束。

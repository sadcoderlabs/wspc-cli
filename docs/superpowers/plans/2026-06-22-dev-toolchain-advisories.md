# Dev toolchain advisories 更新實作計畫

> **給 agentic workers：** 必要 sub-skill：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤。

**目標：** 讓 dev/build/test toolchain 不再觸發 high-level npm audit advisories。

**架構：** 先用 `npm ci` 與 `npm audit --audit-level=high` 重現 baseline，再用最小相容 dependency update 更新 lockfile。若 audit 已乾淨，改走 no-op docs/status PR；若 update 造成 generated drift，依 spec STOP。

**技術棧：** npm、package-lock、TypeScript、Vitest、tsup、openapi-ts。

---

### 任務 1: Audit baseline 與最小更新

**檔案：**
- 可能修改：`package.json`
- 可能修改：`package-lock.json`

- [ ] **步驟 1: 建立乾淨 install baseline**

執行：`npm ci`
預期：exit 0。

- [ ] **步驟 2: 重現 high advisory**

執行：`npm audit --audit-level=high`
預期：若失敗，記錄 high advisory package chain；若 exit 0，改為 no-op status update。

- [ ] **步驟 3: 套用最小 dependency refresh**

優先執行：`npm update vite vitest esbuild @hey-api/openapi-ts`
預期：只更新 package metadata，不新增 dependency，不使用 `--force`。

- [ ] **步驟 4: 驗證 audit**

執行：`npm audit --audit-level=high`
預期：exit 0，或只剩已記錄且不可達的 high advisory。

### 任務 2: Drift、build、test verification

**檔案：**
- 修改：`docs/improve/README.md`
- 驗證：`src/generated/`

- [ ] **步驟 1: 檢查 generated drift**

執行：

```bash
npm run generate
git diff --exit-code -- src/generated
```

預期：generated output 沒有 drift。

- [ ] **步驟 2: 標記 improve plan 完成**

把 `docs/improve/README.md` 內 plan 004 的狀態從 `TODO` 改成 `DONE`。

- [ ] **步驟 3: 最終檢查**

執行：

```bash
npm run typecheck
env -u NO_COLOR FORCE_COLOR=1 npm test
npm run build
git diff --check
```

預期：所有 commands 都以 0 結束。

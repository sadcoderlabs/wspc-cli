# 刪除 exclusive date helper 實作計畫

> **給 agentic workers：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 刪除沒有 production caller 的 `exclusiveEndToInclusive()` helper 與只為它存在的測試。

**架構：** 只修改現有 date utils 與對應測試；保留 `parseDateOnly()`、`inclusiveEndToExclusive()`、generated event command 與 OpenAPI metadata。

**技術：** TypeScript、Luxon、Vitest。

---

## 檔案結構

- 修改：`src/handwritten/utils/parse-date.ts`，刪除 `exclusiveEndToInclusive()` export。
- 修改：`test/handwritten/utils.test.ts`，刪除 `exclusiveEndToInclusive` import 與 describe block。

## 任務 1：刪除未使用 helper

**檔案：**
- 修改：`src/handwritten/utils/parse-date.ts`
- 修改：`test/handwritten/utils.test.ts`

- [ ] **步驟 1：確認 baseline**

```bash
npm test -- test/handwritten/utils.test.ts test/generated/event.test.ts
npm run typecheck
```

預期：2 個 test files 通過，typecheck 通過。

- [ ] **步驟 2：刪除 source helper**

在 `src/handwritten/utils/parse-date.ts` 刪除這段：

```ts
export function exclusiveEndToInclusive(date: string): string {
  return DateTime.fromISO(parseDateOnly(date)).minus({ days: 1 }).toISODate()!
}
```

保留：

```ts
export function inclusiveEndToExclusive(date: string): string {
  return DateTime.fromISO(parseDateOnly(date)).plus({ days: 1 }).toISODate()!
}
```

- [ ] **步驟 3：刪除專用測試**

在 `test/handwritten/utils.test.ts` 的 parse-date import 中移除 `exclusiveEndToInclusive`，並刪除整個 block：

```ts
describe("exclusiveEndToInclusive", () => {
  it("subtracts one day", () => {
    expect(exclusiveEndToInclusive("2026-05-11")).toBe("2026-05-10")
  })

  it("crosses month boundary", () => {
    expect(exclusiveEndToInclusive("2026-06-01")).toBe("2026-05-31")
  })
})
```

- [ ] **步驟 4：確認 helper 已無引用**

```bash
rg "exclusiveEndToInclusive"
```

預期：只允許 spec/plan 文件提到；source 與 test 不可再有引用。

- [ ] **步驟 5：執行驗證**

```bash
npm test -- test/handwritten/utils.test.ts test/generated/event.test.ts
npm run typecheck
```

預期：date helper 測試仍涵蓋 `parseDateOnly()` 與 `inclusiveEndToExclusive()`，generated event tests 通過，typecheck 通過。

- [ ] **步驟 6：commit**

```bash
git add src/handwritten/utils/parse-date.ts test/handwritten/utils.test.ts
git commit -m "refactor(date): delete unused exclusive end helper"
```

## 任務 2：PR 前檢查

**檔案：**
- 驗證全部變更檔案。

- [ ] **步驟 1：rebase 到最新 main**

```bash
git fetch origin main
git rebase origin/main
```

預期：沒有 conflict。

- [ ] **步驟 2：最終 checks**

```bash
npm test -- test/handwritten/utils.test.ts test/generated/event.test.ts
npm run typecheck
git diff --check origin/main..HEAD
rg "exclusiveEndToInclusive"
npm test
```

預期：focused tests、typecheck、diff check、full suite 全部通過；`rg` 只剩 spec/plan/PR 文字脈絡。

- [ ] **步驟 3：Ponytail review**

檢查 diff 是否還有能刪的複雜度。這個 task 本身是刪除；如果沒有新發現就進入 PR。

- [ ] **步驟 4：draft PR 與 todo comment**

```bash
git push -u origin codex/delete-exclusive-date-helper
gh pr create --draft --base main --head codex/delete-exclusive-date-helper --title "Delete unused exclusive date helper" --body-file /tmp/delete-exclusive-date-helper-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVND933J53BRQ3WYEACG2Y2A "<summary>"
```

預期：draft PR body 包含 Todo ID、spec path、plan path、verification commands 與 e2e-smoke note。

## 自我檢查

Spec 覆蓋：本計畫只刪 `exclusiveEndToInclusive()` 與其測試，保留其他 date helper 與 generated event flow。

Placeholder 掃描：沒有 placeholder。

型別一致性：沒有新增型別；刪除後 import 與 export surface 一致。

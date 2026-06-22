# Output renderer shape guards 實作計畫

> **給 agentic workers：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 將 `render.ts` 內重複的 object shape probe 與 `Record<string, unknown>` casts 收斂成少量本地 helper，保持輸出行為不變。

**架構：** 只在 `src/handwritten/output/render.ts` 新增私有 helper：`isRecord()`、`getString()`、`getArray()`。用它們替換現有 inline probes；不新增共用 module、不改 renderer registry、不改 output UX。

**技術：** TypeScript、Vitest、現有 handwritten output renderer。

---

## 檔案結構

- 修改：`src/handwritten/output/render.ts`，新增本地 guard/helper 並替換 casts。
- 修改：`test/output-render.test.ts`，只補一個防止 scalar list crash/throw 的小測試；既有輸出測試保護語意。

## Task 1：Baseline 與 guard 測試

**檔案：**
- 修改：`test/output-render.test.ts`

- [ ] **步驟 1：用 color enabled 跑 baseline**

```bash
env -u NO_COLOR FORCE_COLOR=1 npm test -- test/output-render.test.ts test/handwritten/render-data-path.test.ts test/handwritten/bool-badge.test.ts
```

預期：3 個 test files 通過。這個 shell 的 baseline 不要直接用 raw `npm test`，因為 `NO_COLOR=1` 會讓既有 color assertions 失敗，且和本 refactor 無關。

- [ ] **步驟 2：新增 scalar-list guard 測試**

在 `test/output-render.test.ts` 靠近其他 list tests 的地方新增：

```ts
it("does not throw for scalar list items", () => {
  expect(() => render({ kind: "weird.list", display: { shape: "list" } }, ["one", "two"])).not.toThrow()
})
```

- [ ] **步驟 3：執行新測試**

```bash
env -u NO_COLOR FORCE_COLOR=1 npm test -- test/output-render.test.ts
```

預期：測試通過，或揭露目前行為。如果目前已經通過，仍保留這個測試作為 refactor regression coverage。

## Task 2：本地 shape helpers

**檔案：**
- 修改：`src/handwritten/output/render.ts`

- [ ] **步驟 1：新增小型本地 helpers**

在 `isScalar()` 附近新增這些 private helpers：

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function getArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}
```

不要 export，也不要新增 `utils`。

- [ ] **步驟 2：替換 wrapper/data shape probes**

把 `renderPaginationFooter()`、`drillDataPath()`、`detectShape()`、`extractItems()`、`renderObject()` 裡的 inline checks 改成 `isRecord()` / `getArray()`。控制流與輸出文字必須維持不變。

範例：

```ts
function renderPaginationFooter(data: unknown): void {
  if (!isRecord(data)) return
  const nextCursor = getString(data, "next_cursor")
  if (nextCursor !== undefined && nextCursor.length > 0) {
    process.stdout.write(dim(`  … more results — re-run with --cursor ${nextCursor}`) + "\n")
  }
}
```

```ts
function drillDataPath(data: unknown, dataPath: string | undefined): unknown {
  if (!dataPath) return data
  if (!isRecord(data)) return data
  const value = data[dataPath]
  return value === undefined ? data : value
}
```

- [ ] **步驟 3：替換 list/object item casts**

在 `renderList()` 裡避免盲目 cast 每個 item。最小且保留行為的形狀如下：

```ts
const first = isRecord(items[0]) ? items[0] : {}
const rows = items.map((item) =>
  columns.map((col) =>
    formatCell(isRecord(item) ? item[col] : undefined, format[col], hints?.enumColorMap?.[col]),
  ),
)
```

這會避免 non-record list items throw，同時保留既有 table fallback 行為。

- [ ] **步驟 4：替換 inline format probes**

更新 `formatTodoLike()`、`formatCommentLike()`、`formatAttendeeLike()`，改用 helpers：

```ts
function formatTodoLike(item: unknown): string | null {
  if (!isRecord(item)) return null
  const idValue = getString(item, "id")
  const title = getString(item, "title")
  if (idValue === undefined || title === undefined) return null
  const status = getString(item, "status")
  const id = idShort(idValue)
  const statusText = status === undefined ? "" : statusBadge(status)
  return statusText ? `${id}  ${statusText}  ${title}` : `${id}  ${title}`
}
```

attendee display name 的非空字串判斷只需要 caller 內一行即可；除非用到兩次，不要再新增 helper。

- [ ] **步驟 5：執行 focused checks**

```bash
env -u NO_COLOR FORCE_COLOR=1 npm test -- test/output-render.test.ts test/handwritten/render-data-path.test.ts test/handwritten/bool-badge.test.ts
npm run typecheck
git diff --check
```

預期：全部通過。

- [ ] **步驟 6：commit 實作**

```bash
git add src/handwritten/output/render.ts test/output-render.test.ts
git commit -m "refactor(output): share renderer shape guards"
```

## Task 3：最終驗證與 PR

**檔案：**
- 驗證所有變更檔案。

- [ ] **步驟 1：檢查 cast 減量**

```bash
rg -n "Record<string, unknown>|typeof .*object|Array\\.isArray| as Record" src/handwritten/output/render.ts
```

預期：`Record<string, unknown>` casts 與重複 shape probes 明顯減少；剩餘項目應是 helper definitions 或刻意保留的 scalar checks。

- [ ] **步驟 2：最終 checks**

```bash
git fetch origin main
git rebase origin/main
env -u NO_COLOR FORCE_COLOR=1 npm test -- test/output-render.test.ts test/handwritten/render-data-path.test.ts test/handwritten/bool-badge.test.ts
npm run typecheck
git diff --check origin/main..HEAD
env -u NO_COLOR FORCE_COLOR=1 npm test
```

預期：focused tests、typecheck、diff check、full suite 全部通過。

- [ ] **步驟 3：Ponytail review**

檢查變更檔案是否有 over-engineering。快速可切的項目直接 commit；非小修的 follow-up 放進 WSPC todo comment。

- [ ] **步驟 4：draft PR 與 todo comment**

```bash
git push -u origin codex/refactor-output-renderer-guards
gh pr create --draft --base main --head codex/refactor-output-renderer-guards --title "Refactor output renderer shape guards" --body-file /tmp/output-renderer-guards-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVNASADD17QH6YGXQMRT2WRE "<summary>"
```

預期：draft PR body 包含 Todo ID、spec path、plan path、verification commands 與 e2e-smoke note。

## 自我檢查

Spec coverage：計畫讓 helpers 維持在 `render.ts` 私有範圍，涵蓋 pagination/dataPath/detect/extract/list/object/array item formatting，並避免 output UX 變更。

Placeholder scan：沒有留下延後處理的 placeholder。

Type consistency：helper signatures 只使用 `Record<string, unknown>` 與 `unknown[]`，符合既有 renderer data flow。

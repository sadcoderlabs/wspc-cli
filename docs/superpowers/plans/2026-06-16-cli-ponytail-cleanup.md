# CLI Ponytail Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove low-risk repo bloat from the ponytail audit without changing CLI behavior.

**Architecture:** Keep this as a small cleanup: one dependency removal, one shared test helper, and one reused codegen casing helper. Do not touch auth, renderer registration, generated output, or consistency-bookmark behavior.

**Tech Stack:** TypeScript, Vitest, npm, Commander CLI codegen.

---

## File Structure

- Modify `package.json`: remove unused `rimraf` from `devDependencies`.
- Modify `package-lock.json`: let npm remove the matching lock entries.
- Create `test/helpers/stdout.ts`: shared stdout capture and ANSI stripping helpers.
- Modify `test/output-render.test.ts`: import stdout helpers and remove local copies.
- Modify `test/output-primitives.test.ts`: import `stripAnsi` and remove local copy.
- Modify `test/generated/keys.test.ts`: import stdout helpers and remove local copies.
- Modify `test/generated/org.test.ts`: import stdout helpers and remove local copies.
- Modify `tools/cli-codegen/emit.ts`: export one snake-case to camel-case helper and use it internally.
- Modify `tools/cli-codegen/main.ts`: import the helper from `emit.ts` and remove its local duplicate.

## Task 1: Remove unused `rimraf`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Verify `rimraf` is unused**

Run:

```bash
rg -n "rimraf" . -g '!node_modules' -g '!package-lock.json'
```

Expected: only `package.json` contains `rimraf`.

- [ ] **Step 2: Remove the dependency mechanically**

Run:

```bash
npm uninstall rimraf --save-dev
```

Expected: `package.json` and `package-lock.json` change.

- [ ] **Step 3: Verify it is gone**

Run:

```bash
rg -n "rimraf" package.json package-lock.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused rimraf dependency"
```

## Task 2: Share stdout test helpers

**Files:**
- Create: `test/helpers/stdout.ts`
- Modify: `test/output-render.test.ts`
- Modify: `test/output-primitives.test.ts`
- Modify: `test/generated/keys.test.ts`
- Modify: `test/generated/org.test.ts`

- [ ] **Step 1: Create the helper**

Create `test/helpers/stdout.ts`:

```ts
import { vi } from "vitest"

export function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk))
    return true
  })
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  }
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}
```

- [ ] **Step 2: Update renderer tests**

In `test/output-render.test.ts`, add:

```ts
import { captureStdout, stripAnsi } from "./helpers/stdout.js"
```

Remove the local `captureStdout` and `stripAnsi` functions. Keep the rest of the file unchanged.

- [ ] **Step 3: Update primitive tests**

In `test/output-primitives.test.ts`, add:

```ts
import { stripAnsi } from "./helpers/stdout.js"
```

Remove the local `stripAnsi` function. Keep the rest of the file unchanged.

- [ ] **Step 4: Update generated command tests**

In `test/generated/keys.test.ts` and `test/generated/org.test.ts`, add:

```ts
import { captureStdout, stripAnsi } from "../helpers/stdout.js"
```

Remove the local `captureStdout` and `stripAnsi` functions from both files. Keep the rest of each file unchanged.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- output-render.test.ts output-primitives.test.ts generated/keys.test.ts generated/org.test.ts
```

Expected: all four files pass.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/stdout.ts test/output-render.test.ts test/output-primitives.test.ts test/generated/keys.test.ts test/generated/org.test.ts
git commit -m "test: share stdout helpers"
```

## Task 3: Reuse codegen casing helper

**Files:**
- Modify: `tools/cli-codegen/emit.ts`
- Modify: `tools/cli-codegen/main.ts`

- [ ] **Step 1: Export and reuse one helper in `emit.ts`**

In `tools/cli-codegen/emit.ts`, replace the local casing helpers with:

```ts
export function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function kebab(s: string): string {
  return s.replace(/_/g, "-")
}

function kebabToCamel(kebabStr: string): string {
  return kebabStr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
```

Set the generated SDK function name with:

```ts
const fnName = snakeToCamel(input.operationId)
```

Replace every `camelize(...)` call in `emit.ts` with `kebabToCamel(...)`.

- [ ] **Step 2: Use the exported helper in `main.ts`**

In `tools/cli-codegen/main.ts`, change the import to:

```ts
import { emitCommand, snakeToCamel, type XCli, type BodyField } from "./emit.js"
```

Remove the local `camelize` function and set command variable names with:

```ts
varName: `${snakeToCamel(op.operationId)}Command`,
```

- [ ] **Step 3: Regenerate CLI to prove output is stable**

Run:

```bash
npm run generate:cli
```

Expected: no `src/generated/cli` diff, because helper reuse should not change generated output.

- [ ] **Step 4: Run codegen-adjacent verification**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tools/cli-codegen/emit.ts tools/cli-codegen/main.ts
git commit -m "refactor: reuse codegen casing helper"
```

## Task 4: Final verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full tests**

```bash
npm test
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Check whitespace**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect final diff**

```bash
git status --short
git diff --stat origin/main...HEAD
```

Expected: only the spec, plan, dependency cleanup, test helper cleanup, and codegen helper cleanup are present.

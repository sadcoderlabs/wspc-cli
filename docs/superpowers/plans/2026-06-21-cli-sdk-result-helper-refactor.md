# CLI SDK Result Helper Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 generated commands、`todo done`、`email send` 重複的 SDK result handling 收斂到一個小 helper，維持既有 CLI 行為。

**Architecture:** 新增 `src/handwritten/commands/sdk-result.ts` 作為唯一 raw SDK client 與 HTTP error/render boundary。Codegen 只產生 operation args，然後呼叫 helper；`exitOnField` 保留在 generated command，靠 helper 回傳 result 檢查。Handwritten commands 保留自己的 validation/body construction，只把 SDK result handling 交給 helper。

**Tech Stack:** TypeScript, Commander, Hey API generated SDK, Vitest, existing `render()` output helper.

---

## Files

- Create: `src/handwritten/commands/sdk-result.ts`
  - Small helper: load SDK client, call operation with raw client, render success data, print current HTTP error format on failure.
- Create: `test/handwritten/sdk-result.test.ts`
  - Direct coverage for helper success, selected data, HTTP error output, and undefined selected data.
- Modify: `tools/cli-codegen/emit.ts`
  - Generated commands import `runSdkCommand()` instead of `loadSdkClient()` and `render()`.
- Modify: `tools/cli-codegen/emit.test.ts`
  - Assert generated code uses the helper and preserves `exitOnField`.
- Modify: `test/cli-codegen.test.ts`
  - Update string expectations for generated helper import/call.
- Regenerate: `src/generated/cli/**/*.ts`
  - Mechanical output from `npm run generate`.
- Modify: `src/handwritten/commands/todo-done.ts`
  - Replace local SDK result handling with `runSdkCommand()`.
- Modify: `src/handwritten/commands/email/send.ts`
  - Keep validation/body logic, replace result handling with `runSdkCommand()` and a selector for `result.data?.email`.
- Modify: `test/handwritten/email-send.test.ts`
  - Keep behavior checks and add/adjust HTTP error coverage if missing.

## Task 1: Add SDK Result Helper

**Files:**
- Create: `src/handwritten/commands/sdk-result.ts`
- Create: `test/handwritten/sdk-result.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `test/handwritten/sdk-result.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const loadSdkClient = vi.fn()
const render = vi.fn()

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({ loadSdkClient }))
vi.mock("../../src/handwritten/output/render.js", () => ({ render }))

import { runSdkCommand } from "../../src/handwritten/commands/sdk-result.js"

describe("runSdkCommand", () => {
  beforeEach(() => {
    loadSdkClient.mockReset()
    render.mockReset()
    process.exitCode = undefined
  })

  it("loads the raw SDK client and renders result.data", async () => {
    const rawClient = { raw: true }
    loadSdkClient.mockResolvedValue({ _rawClient: rawClient })

    const result = await runSdkCommand(
      { kind: "todo_get", display: { shape: "object" } },
      async (client) => {
        expect(client).toBe(rawClient)
        return { data: { id: "tod_1" }, response: { ok: true, status: 200 } }
      },
    )

    expect(result?.data).toEqual({ id: "tod_1" })
    expect(render).toHaveBeenCalledWith(
      { kind: "todo_get", display: { shape: "object" } },
      { id: "tod_1" },
    )
  })

  it("renders selected success data", async () => {
    loadSdkClient.mockResolvedValue({ _rawClient: {} })

    await runSdkCommand(
      { kind: "email_send", display: { shape: "object" } },
      async () => ({
        data: { email: { id: "eml_1" }, idempotent_replay: false },
        response: { ok: true, status: 200 },
      }),
      (result) => result.data?.email,
    )

    expect(render).toHaveBeenCalledWith(
      { kind: "email_send", display: { shape: "object" } },
      { id: "eml_1" },
    )
  })

  it("prints current HTTP error format and sets exitCode", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    loadSdkClient.mockResolvedValue({ _rawClient: {} })

    const result = await runSdkCommand(
      { kind: "todo_get", display: { shape: "object" } },
      async () => ({ error: { message: "bad" }, response: { ok: false, status: 400 } }),
    )

    expect(result).toBeUndefined()
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith("HTTP 400: {\\n  \"message\": \"bad\"\\n}\\n")
    expect(render).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it("does not render when selected data is undefined", async () => {
    loadSdkClient.mockResolvedValue({ _rawClient: {} })

    await runSdkCommand(
      { kind: "empty", display: { shape: "object" } },
      async () => ({ data: { value: 1 }, response: { ok: true, status: 200 } }),
      () => undefined,
    )

    expect(render).toHaveBeenCalledWith({ kind: "empty", display: { shape: "object" } }, undefined)
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- test/handwritten/sdk-result.test.ts
```

Expected: FAIL because `src/handwritten/commands/sdk-result.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/handwritten/commands/sdk-result.ts`:

```ts
import { loadSdkClient } from "../auth/load-sdk-client.js"
import { render } from "../output/render.js"
import type { RenderContext } from "../output/types.js"

export interface SdkCommandResult<TData> {
  data?: TData
  error?: unknown
  response?: {
    ok?: boolean
    status?: number
  }
}

export async function runSdkCommand<TData, TSelected = TData>(
  ctx: RenderContext,
  operation: (client: never) => Promise<SdkCommandResult<TData>>,
  selectData?: (result: SdkCommandResult<TData>) => TSelected | undefined,
): Promise<SdkCommandResult<TData> | undefined> {
  const client = await loadSdkClient()
  const result = await operation(client._rawClient as never)
  if (result.error || !result.response?.ok) {
    process.stderr.write(
      `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
    )
    process.exitCode = 1
    return undefined
  }
  render(ctx, selectData === undefined ? result.data : selectData(result))
  return result
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- test/handwritten/sdk-result.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/commands/sdk-result.ts test/handwritten/sdk-result.test.ts
git commit -m "feat(cli): add sdk result command helper"
```

## Task 2: Update Codegen To Use Helper

**Files:**
- Modify: `tools/cli-codegen/emit.ts`
- Modify: `tools/cli-codegen/emit.test.ts`
- Modify: `test/cli-codegen.test.ts`
- Regenerate: `src/generated/cli/**/*.ts`

- [ ] **Step 1: Update tests for generated helper usage**

In `test/cli-codegen.test.ts`, update the first test expectations:

```ts
expect(code).toContain('import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"')
expect(code).toContain("return runSdkCommand(")
expect(code).toContain("todoCreate({")
expect(code).toContain("client,")
expect(code).not.toContain("loadSdkClient")
expect(code).not.toContain('from "../../../handwritten/output/render.js"')
```

In `tools/cli-codegen/emit.test.ts`, update the `exitOnField` test to expect the returned helper result:

```ts
expect(code).toContain("const result = await runSdkCommand(")
expect(code).toContain("if (result?.data?.ok === false) {")
expect(code).toContain("process.exit(1)")
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts
```

Expected: FAIL because codegen still emits inline `loadSdkClient()` / `render()`.

- [ ] **Step 3: Modify `emit.ts` imports and action body**

In `tools/cli-codegen/emit.ts`, replace generated imports:

```ts
const imports: string[] = [
  `import { Command } from "commander"`,
  `import { ${fnName} } from "${sdkRelPrefix}sdk/index.js"`,
  `import { runSdkCommand } from "${handwrittenRelPrefix}handwritten/commands/sdk-result.js"`,
]
```

Replace the emitted SDK call / error / render block with:

```ts
    `    const result = await runSdkCommand({ kind: ${JSON.stringify(kind)}, display: ${displayLiteral} }, (client) => ${fnName}({`,
    `      client,`,
    ...pathBlock,
    ...bodyBlock,
    ...queryBlock,
    `    }))`,
    ...exitLines,
```

Update `exitOnField` generation to use optional `result`:

```ts
const accessExpr = pathParts.length > 0 ? `result?.data?.${pathParts.join("?.")}` : `result?.data`
```

- [ ] **Step 4: Run codegen tests**

Run:

```bash
npm test -- tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts
```

Expected: PASS.

- [ ] **Step 5: Regenerate CLI output**

Run:

```bash
npm run generate
```

Expected: generated CLI files mechanically replace inline result handling with `runSdkCommand()`.

- [ ] **Step 6: Run focused generated verification**

Run:

```bash
npm test -- tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/cli-codegen/emit.ts tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts src/generated/cli
git commit -m "refactor(cli): use sdk result helper in generated commands"
```

## Task 3: Update Handwritten Commands

**Files:**
- Modify: `src/handwritten/commands/todo-done.ts`
- Modify: `src/handwritten/commands/email/send.ts`
- Modify: `test/handwritten/email-send.test.ts`

- [ ] **Step 1: Add handwritten HTTP error regression if missing**

In `test/handwritten/email-send.test.ts`, add:

```ts
it("prints SDK HTTP errors", async () => {
  process.exitCode = undefined
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  sendMock.mockResolvedValueOnce({
    error: { message: "bad request" },
    response: { ok: false, status: 400 },
  })

  await sendCommand.parseAsync([
    "node", "send",
    "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
    "--idempotency-key", "k-http",
  ])

  expect(process.exitCode).toBe(1)
  expect(errSpy).toHaveBeenCalledWith("HTTP 400: {\\n  \"message\": \"bad request\"\\n}\\n")
  errSpy.mockRestore()
  process.exitCode = undefined
})
```

- [ ] **Step 2: Run email test to verify current behavior**

Run:

```bash
npm test -- test/handwritten/email-send.test.ts
```

Expected: PASS before refactor, proving behavior exists.

- [ ] **Step 3: Refactor `todo-done.ts`**

Replace imports and action body with:

```ts
import { Command } from "commander"
import { todoUpdate } from "../../generated/sdk/index.js"
import type { XCliDisplay } from "../output/types.js"
import { runSdkCommand } from "./sdk-result.js"
```

```ts
.action(async (id: string) => {
  return runSdkCommand(
    { kind: "todo_update", display: TODO_UPDATE_DISPLAY },
    (client) => todoUpdate({
      client,
      path: { id },
      body: { status: "done" } as never,
    }),
  )
})
```

- [ ] **Step 4: Refactor `email/send.ts`**

Replace `loadSdkClient` / `render` imports with:

```ts
import { runSdkCommand } from "../sdk-result.js"
```

Replace the final SDK result block with:

```ts
return runSdkCommand(
  { kind: "object", display: { shape: "object", format: { id: "id-short" } } },
  (client) => emailSend({
    client,
    body,
  } as never),
  (result) => result.data?.email,
)
```

- [ ] **Step 5: Run focused handwritten verification**

Run:

```bash
npm test -- test/handwritten/email-send.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handwritten/commands/todo-done.ts src/handwritten/commands/email/send.ts test/handwritten/email-send.test.ts
git commit -m "refactor(cli): use sdk result helper in handwritten commands"
```

## Final Verification

- [ ] Run:

```bash
npm run generate
npm test -- tools/cli-codegen/emit.test.ts test/cli-codegen.test.ts test/handwritten/email-send.test.ts test/handwritten/sdk-result.test.ts
npm run typecheck
npm test
```

Expected: all commands pass and `git status --short` shows only intentional generated changes already committed.

## Self-Review

- Spec coverage: helper, codegen, regenerate output, handwritten commands, error/render behavior, raw client boundary, no dependency, no middleware framework are covered.
- Placeholder scan: no placeholder markers or "similar to" shortcuts.
- Type consistency: helper uses `SdkCommandResult<TData>` and returns the result so generated `exitOnField` remains outside helper.

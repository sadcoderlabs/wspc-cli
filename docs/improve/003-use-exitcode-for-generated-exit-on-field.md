# Plan 003: Use `process.exitCode` for generated `exitOnField`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's row in `docs/improve/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1bb2860..HEAD -- tools/cli-codegen/emit.ts tools/cli-codegen/emit.test.ts src/generated/cli/push/test.ts test/generated/push.test.ts src/cli.ts docs/superpowers/specs/2026-06-21-cli-sdk-result-helper-refactor-design.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1bb2860`, 2026-06-22
- **Todo**: `tod_01KVPNG12KZWA08Y1GKQ0FMECA`

## Why this matters

The CLI entrypoint intentionally uses `process.exitCode` instead of `process.exit()` so Node can close fetch and file-stream handles cleanly, especially on Windows. Generated `exitOnField` code still emits `process.exit(1)`, so one generated command path violates that rule. This is a one-line generator fix plus regenerated output and tests.

## Current state

- `src/cli.ts:107-110` documents why `exitCode` is used instead of forced exit.
- `tools/cli-codegen/emit.ts:448-456` emits `process.exit(1)` for `x-cli.exitOnField`.
- `src/generated/cli/push/test.ts:27` currently contains generated `process.exit(1)`.
- `test/generated/push.test.ts:111-123` expects `process.exit(1)`.
- `docs/superpowers/specs/2026-06-21-cli-sdk-result-helper-refactor-design.md:5` says generated command failures should set `process.exitCode = 1`.

Relevant excerpt:

```ts
// tools/cli-codegen/emit.ts:453
exitLines.push(
  `    if (${accessExpr} === ${JSON.stringify(exitOnField.failOn)}) {`,
  `      process.exit(1)`,
  `    }`,
)
```

Repo conventions to match:

- Generated files are committed but not hand-edited; change `tools/cli-codegen/emit.ts`, then run `npm run generate`.
- Keep generated behavior otherwise stable.
- No new helper for this tiny change.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps | `npm ci` | exit 0 |
| Codegen tests | `npm test -- tools/cli-codegen/emit.test.ts test/generated/push.test.ts` | all pass |
| Regenerate | `npm run generate` | exit 0; generated CLI diff only where expected |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope**:

- `tools/cli-codegen/emit.ts`
- `tools/cli-codegen/emit.test.ts`
- `src/generated/cli/push/test.ts` via `npm run generate`
- `test/generated/push.test.ts`

**Out of scope**:

- Do not implement the larger SDK result helper refactor from the spec.
- Do not edit generated files by hand.
- Do not change normal HTTP error handling.
- Do not change `tools/cli-codegen/main.ts` process exit behavior; that is a development script, not emitted CLI runtime.

## Git workflow

- Branch: `codex/fix-generated-exitcode`
- Commit message example: `fix(cli): avoid forced exit in generated commands`

## Steps

### Step 1: Update generator tests first

In `tools/cli-codegen/emit.test.ts`, change `exitOnField` expectations from `process.exit(1)` to `process.exitCode = 1`. In `test/generated/push.test.ts`, replace the `process.exit` spy with an assertion on `process.exitCode`, following other command tests in the repo.

**Verify**: `npm test -- tools/cli-codegen/emit.test.ts test/generated/push.test.ts` fails before changing the generator.

### Step 2: Change emitted code

In `tools/cli-codegen/emit.ts`, change the `exitOnField` emitted line to:

```ts
`      process.exitCode = 1`,
```

No return is required after render unless existing command behavior requires it; preserve current behavior except the forced exit.

**Verify**: `npm test -- tools/cli-codegen/emit.test.ts` passes.

### Step 3: Regenerate generated CLI output

Run `npm run generate`. Inspect the diff and confirm only generated CLI files affected by `exitOnField` changed, likely `src/generated/cli/push/test.ts`.

**Verify**: `rg -n "process\\.exit\\(1\\)" src/generated/cli tools/cli-codegen/emit.ts test/generated/push.test.ts` returns no generated runtime matches. Development script matches outside this scope may remain.

### Step 4: Run focused and full checks

Run focused tests, typecheck, and full tests.

**Verify**: commands in the table pass.

## Test plan

- Generator unit tests assert `process.exitCode = 1`.
- Generated push command test asserts `process.exitCode` is set when `ok` is false.
- Typecheck catches any action-return or typing drift.

## Done criteria

- [ ] No generated CLI runtime code calls `process.exit(1)`.
- [ ] `push test` still renders and marks failure status with exit code 1.
- [ ] Regenerated output is mechanical.
- [ ] Focused tests, typecheck, full tests, and `git diff --check` pass.
- [ ] `docs/improve/README.md` status row updated.

## STOP conditions

- Regeneration changes OpenAPI spec or generated SDK output unexpectedly.
- `exitOnField` semantics require aborting before render for some command.
- Tests reveal another generated runtime forced-exit path that needs broader design.

## Maintenance notes

The larger SDK result helper refactor already exists as a separate spec/todo. This plan intentionally fixes only the correctness bug; do not smuggle in that refactor.

# Plan 001: Route config mutations through `ConfigStore.update()`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1bb2860..HEAD -- src/handwritten/config/index.ts src/handwritten/auth/login.ts src/handwritten/auth/logout.ts src/handwritten/auth/client-registration.ts src/handwritten/commands/account.ts src/handwritten/commands/config.ts src/handwritten/commands/whoami.ts test/config-lock.test.ts test/login.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts test/client-registration.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1bb2860`, 2026-06-22
- **Todo**: `tod_01KVPNFXWY53912DVECQA9FHHD`

## Why this matters

The repo already fixed one config race by adding `ConfigStore.update()`, but several command/auth paths still perform `read()` followed by `write()`. Those paths can overwrite token refreshes, consistency bookmarks, or account changes that land between the read and write. The fix is boring: use the existing locked read-modify-write helper for mutations, and leave pure reads alone.

## Current state

- `DEVELOPER.md:35` states the convention: config, token refresh, and bookmark writes must not bypass `ConfigStore.update()`.
- `src/handwritten/config/index.ts:162-167` implements `update()` by taking a lock, re-reading config, mutating in place, and writing.
- `src/handwritten/auth/login.ts:80-108` and `src/handwritten/auth/login.ts:138-155` read, mutate, then write login state directly.
- `src/handwritten/auth/logout.ts:23-50`, `src/handwritten/auth/client-registration.ts:32-61`, `src/handwritten/commands/account.ts:28-37`, `src/handwritten/commands/config.ts:39-57`, `src/handwritten/commands/config.ts:97-101`, and `src/handwritten/commands/whoami.ts:51-53` also mutate config with direct writes.

Relevant excerpts:

```ts
// src/handwritten/config/index.ts:162
async update(mutate: (config: WspcConfig) => void): Promise<void> {
  await this.withLock(async () => {
    const config = await this.read()
    mutate(config)
    await this.write(config)
  })
}
```

```ts
// src/handwritten/auth/logout.ts:30
if (opts.all) {
  const removed = Object.keys(env.accounts)
  env.accounts = {}
  env.current_account = undefined
  await opts.store.write(c)
  return { removed }
}
```

Repo conventions to match:

- TypeScript is strict ESM.
- Use `undefined`, not `null`, for empty local values.
- Keep comments sparse; only explain surprising behavior.
- Tests use Vitest and temp-dir `ConfigStore`.
- Commit messages are conventional, for example `fix(config): serialize command mutations`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps | `npm ci` | exit 0 |
| Focused tests | `npm test -- test/config-lock.test.ts test/login.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts test/client-registration.test.ts` | all listed tests pass |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Full tests | `npm test` | all tests pass |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope**:

- `src/handwritten/auth/login.ts`
- `src/handwritten/auth/logout.ts`
- `src/handwritten/auth/client-registration.ts`
- `src/handwritten/commands/account.ts`
- `src/handwritten/commands/config.ts`
- `src/handwritten/commands/whoami.ts`
- Existing tests listed above; add focused regression tests where useful.

**Out of scope**:

- Do not change `ConfigStore.withLock()` semantics.
- Do not change config schema or file location.
- Do not change auth protocol, token refresh behavior, or consistency bookmark behavior.
- Do not edit generated files.

## Git workflow

- Branch: `codex/fix-config-update-mutations`
- Commit logical changes with conventional messages.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add race regression coverage

Extend `test/config-lock.test.ts` with one or two focused tests that fail when a direct `read()`/`write()` overwrites an interleaved update. Keep them small. Good candidates:

- Seed config with one account and one bookmark.
- Start a helper mutation such as `switchAccount()` or `setConfigKey()` while an interleaved `store.update()` changes `consistency_bookmarks`.
- Assert both the command mutation and interleaved bookmark/token mutation survive.

Use existing tests in `test/config-lock.test.ts` as the structural pattern.

**Verify**: `npm test -- test/config-lock.test.ts` initially fails on the new regression test before implementation.

### Step 2: Convert command/account config writes

Update the simple command helpers first:

- `switchAccount()` in `src/handwritten/commands/account.ts`
- `setConfigKey()` and `config use` action in `src/handwritten/commands/config.ts`
- `backfillActiveEmail()` in `src/handwritten/commands/whoami.ts`
- `runLogout()` in `src/handwritten/auth/logout.ts`

Use `store.update((c) => { ... })` and keep the existing error messages. For helpers that return data, capture `removed` or `newActive` in outer variables inside the mutator and return after `update()` completes.

**Verify**: `npm test -- test/config-lock.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts` passes.

### Step 3: Convert login and client registration writes

Update `runLogin()` and `ensureClientId()` carefully:

- Keep network calls outside the lock.
- Use `store.update()` for the pre-registration env creation in `ensureClientId()`.
- After network responses, use `store.update()` to merge only the specific env/account/client id fields.
- Preserve the current behavior that OAuth login removes stale `api_key`, and API key login removes stale OAuth tokens.

Do not hold the lock during device-flow polling or HTTP registration.

**Verify**: `npm test -- test/login.test.ts test/client-registration.test.ts test/load-sdk-client.test.ts` passes.

### Step 4: Sweep for remaining production bypasses

Run:

```bash
rg -n "await .*\\.write\\(|store\\.write\\(" src/handwritten
```

Only acceptable remaining matches should be inside `src/handwritten/config/index.ts` itself or pure initial test/setup paths if any production path genuinely needs a whole-file write and is documented. If a production mutation remains, either convert it or stop and explain why it cannot use `update()`.

**Verify**: the `rg` output contains no unexpected production direct mutation writes.

## Test plan

- Add/adjust tests in `test/config-lock.test.ts` for interleaved command mutation plus bookmark/token mutation.
- Keep existing command tests as behavior guards.
- Run the focused test command, then `npm run typecheck`, then `npm test`.

## Done criteria

- [ ] All production config mutations use `ConfigStore.update()` unless a remaining direct write is explicitly justified in code review.
- [ ] New regression test fails before the fix and passes after.
- [ ] Focused tests, typecheck, full tests, and `git diff --check` pass.
- [ ] No generated files are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- You need to change the `ConfigStore` lock algorithm to make this work.
- A helper's return value cannot be preserved without changing public behavior.
- Network calls would need to run inside the config lock.
- Existing tests show that a direct write is intentionally required for a specific path.

## Maintenance notes

Reviewers should look for accidental stale snapshot writes. Future config mutations should start from `store.update()` by default; direct `write()` is a low-level primitive, not the normal command API.

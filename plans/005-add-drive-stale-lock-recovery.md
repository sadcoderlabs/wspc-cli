# Plan 005: Add stale Drive sync lock recovery

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1bb2860..HEAD -- src/handwritten/commands/drive/state.ts src/handwritten/commands/drive/watch.ts test/handwritten/drive/state.test.ts test/handwritten/drive/watch.test.ts docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md docs/superpowers/specs/2026-06-21-drive-sync-watch-design.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `1bb2860`, 2026-06-22
- **Todo**: `tod_01KVPNG3FCQ9ZERTH37BPCHWR5`

## Why this matters

Drive sync/watch now has enough foreground usage that a crash leaving `.wspc-drive/sync.lock` behind can permanently block the folder until the user manually deletes the file. Earlier specs intentionally deferred stale-lock recovery for v1; this plan revisits that deferred item with the smallest implementation. It should recover only old orphan locks, not allow concurrent syncs to overlap.

## Current state

- `docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md:107` says v1 fails when the lock exists and does not implement stale-lock recovery.
- `src/handwritten/commands/drive/state.ts:136-149` creates `.wspc-drive/sync.lock` with exclusive create and throws `sync lock already exists` on `EEXIST`.
- `src/handwritten/commands/drive/watch.ts:250-252` treats `sync lock already exists` as a fatal watch error.
- `test/handwritten/drive/state.test.ts` already covers active lock failure and lock cleanup after success/failure.

Relevant excerpt:

```ts
// src/handwritten/commands/drive/state.ts:136
export async function withDriveLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const lockFile = join(root, DRIVE_DIR, "sync.lock")
  const fh = await open(lockFile, "wx").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("sync lock already exists")
    }
    throw error
  })
```

Repo conventions to match:

- Use native `fs` primitives; do not add a lock dependency.
- The config store already uses a simple stale lock pattern in `src/handwritten/config/index.ts:170-203`; borrow the idea, not a new abstraction.
- Drive state timestamps use ISO strings; do not introduce a clock framework in this plan.
- Because this changes a previously documented deferral, update the relevant spec text first.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps | `npm ci` | exit 0 |
| Focused tests | `npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/watch.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Full tests | `npm test` | all pass |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope**:

- `docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- `docs/superpowers/specs/2026-06-21-drive-sync-watch-design.md`
- `src/handwritten/commands/drive/state.ts`
- `test/handwritten/drive/state.test.ts`
- `test/handwritten/drive/watch.test.ts` only if watch fatal/retry behavior needs expectation updates.

**Out of scope**:

- Do not add a Drive operation queue.
- Do not add background daemon or polling.
- Do not change sync decision logic.
- Do not make active lock contention retry forever.
- Do not add per-account or cross-folder locks.

## Git workflow

- Branch: `codex/drive-stale-lock-recovery`
- Commit message example: `fix(drive): recover stale sync locks`

## Steps

### Step 1: Update specs for the new decision

In the Drive sync specs, replace the out-of-scope stale-lock language with a short note:

- v1 originally failed on existing lock.
- Current behavior may steal a lock older than a conservative threshold, for example 10 minutes.
- Fresh locks still fail with `sync lock already exists`.

Keep docs in Traditional Chinese, matching repo rules.

**Verify**: `rg -n "不實作 stale-lock recovery|stale-lock recovery。|stale lock recovery" docs/superpowers/specs/2026-06-21-drive-*.md` shows no stale outdated claim, except a new note describing supported stale recovery.

### Step 2: Add stale lock tests

In `test/handwritten/drive/state.test.ts`, add tests:

- A fresh existing `sync.lock` still causes `withDriveLock()` to reject with `sync lock already exists`.
- An old `sync.lock` is removed/stolen and the callback runs.
- If removing the old lock races with another process recreating it, the function must not run concurrently. This can be covered simply by preserving the existing exclusive-create loop; do not over-mock the filesystem unless necessary.

Use `fs.writeFile()` plus `fs.utimes()` to age the lock file; no fake timers required.

**Verify**: `npm test -- test/handwritten/drive/state.test.ts` fails before implementation.

### Step 3: Implement minimal stale recovery

In `withDriveLock()`:

- Define a conservative `STALE_MS`, recommended `10 * 60 * 1000`.
- On `EEXIST`, stat the lock.
- If it is older than `STALE_MS`, remove it with `rm(lockFile, { force: true })`, then retry exclusive open.
- If it is fresh, throw `sync lock already exists` exactly as today.
- Keep the callback wrapped in `try/finally` and remove the lock on exit.

Do not wait/spin on fresh locks; watch still treats an active other sync as fatal.

**Verify**: `npm test -- test/handwritten/drive/state.test.ts` passes.

### Step 4: Verify watch semantics

If watch tests assume every existing lock is fatal, update only the stale-lock-specific expectation. Fresh lock remains fatal. Stale lock recovery should happen inside `runDriveSyncOnce()`/`withDriveLock()`, not in watch.

**Verify**: `npm test -- test/handwritten/drive/watch.test.ts` passes.

## Test plan

- State tests for fresh lock rejection, stale lock recovery, and lock cleanup after callback success/failure.
- Existing watch tests prove fresh lock remains fatal.
- Full Drive state/watch tests plus typecheck.

## Done criteria

- [ ] Fresh `sync.lock` still prevents overlapping sync.
- [ ] Stale `sync.lock` is recovered and callback runs.
- [ ] Specs no longer claim stale-lock recovery is out of scope.
- [ ] Focused tests, typecheck, full tests, and `git diff --check` pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Tests require adding a polling/retry loop for fresh locks.
- The implementation would need process IDs, host IDs, or lock metadata.
- A stale lock cannot be safely distinguished with filesystem mtime on supported platforms.
- Watch behavior would change to hide active concurrent syncs.

## Maintenance notes

This is intentionally less ambitious than a full lock service. If Drive later gets a background daemon or multi-process queue, revisit the lock design then.

# Drive clock helper 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Drive 產生 timestamp 的地方集中到一個使用 Luxon 的小 helper，保留 state schema 與 conflict copy filename 格式。

**Architecture:** 新增 `clock.ts`，只輸出 Drive 需要的 ISO timestamp 與 conflict filename timestamp。現有 Drive modules 透過可選 `DriveClock` 注入 fixed time 給測試；預設仍用 UTC system clock，不新增全 repo abstraction。

**Tech Stack:** TypeScript、Luxon `DateTime`、Vitest、現有 Drive state/sync/merge/realtime modules。

---

## File Structure

- Create: `src/handwritten/commands/drive/clock.ts`，定義 `DriveClock`、`systemDriveClock`、`driveIsoTimestamp()`、`driveConflictTimestamp()`。
- Create: `test/handwritten/drive/clock.test.ts`，直接測固定 clock 的 ISO 與 filename timestamp。
- Modify: `src/handwritten/commands/drive/state.ts`，讓 `initDriveState()` / `writeDriveState()` 接受可選 clock。
- Modify: `src/handwritten/commands/drive/sync.ts`，讓 `runDriveSyncOnce()` 接受可選 clock 並用 helper 產生 `last_synced_at` / `detected_at` / conflict copy timestamp。
- Modify: `src/handwritten/commands/drive/merge.ts`，讓 `conflictCopyPath()` 接受 compact timestamp string。
- Modify: `src/handwritten/commands/drive/realtime.ts`，把 `now?: () => Date` 改成 `clock?: DriveClock` 並用 helper 寫 realtime metadata。
- Modify: Drive tests，移除 conflict-copy fake timers，改注入 fixed clock。

## Task 1: Clock Helper

**Files:**
- Create: `src/handwritten/commands/drive/clock.ts`
- Create: `test/handwritten/drive/clock.test.ts`

- [ ] **Step 1: Write RED helper tests**

Create `test/handwritten/drive/clock.test.ts`:

```ts
import { DateTime } from "luxon"
import { describe, expect, it } from "vitest"
import { driveConflictTimestamp, driveIsoTimestamp, type DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00.123+08:00", { setZone: true }),
}

describe("drive clock", () => {
  it("formats ISO timestamps with zone information", () => {
    expect(driveIsoTimestamp(fixedClock)).toBe("2026-06-21T10:10:00.123+08:00")
  })

  it("formats conflict filename timestamps in UTC seconds", () => {
    expect(driveConflictTimestamp(fixedClock)).toBe("20260621T021000Z")
  })
})
```

- [ ] **Step 2: Run RED**

```bash
npm test -- test/handwritten/drive/clock.test.ts
```

Expected: fail because `clock.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/handwritten/commands/drive/clock.ts`:

```ts
import { DateTime } from "luxon"

export interface DriveClock {
  now(): DateTime
}

export const systemDriveClock: DriveClock = {
  now: () => DateTime.utc(),
}

export function driveIsoTimestamp(clock: DriveClock = systemDriveClock): string {
  return clock.now().toISO()
}

export function driveConflictTimestamp(clock: DriveClock = systemDriveClock): string {
  return clock.now().toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")
}
```

- [ ] **Step 4: Run GREEN**

```bash
npm test -- test/handwritten/drive/clock.test.ts
npm run typecheck
```

Expected: helper tests and typecheck pass.

- [ ] **Step 5: Commit helper**

```bash
git add src/handwritten/commands/drive/clock.ts test/handwritten/drive/clock.test.ts
git commit -m "test(drive): cover drive clock helper"
```

## Task 2: State And Merge Wiring

**Files:**
- Modify: `src/handwritten/commands/drive/state.ts`
- Modify: `src/handwritten/commands/drive/merge.ts`
- Modify: `test/handwritten/drive/state.test.ts`
- Modify: `test/handwritten/drive/merge.test.ts`

- [ ] **Step 1: Add fixed-clock state expectations**

In `test/handwritten/drive/state.test.ts`, import `DateTime` and `DriveClock`, then add a fixed clock:

```ts
import { DateTime } from "luxon"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00.123Z", { setZone: true }),
}
```

Update or add assertions so `initDriveState(root, "lib_123", fixedClock)` creates:

```ts
expect(state.created_at).toBe("2026-06-21T10:10:00.123Z")
expect(state.updated_at).toBe("2026-06-21T10:10:00.123Z")
```

Add a write assertion:

```ts
await writeDriveState(root, { ...state, updated_at: "old" }, fixedClock)
expect((await readDriveState(root)).updated_at).toBe("2026-06-21T10:10:00.123Z")
```

- [ ] **Step 2: Update merge test expectation**

In `test/handwritten/drive/merge.test.ts`, change the conflict copy test to call:

```ts
expect(conflictCopyPath("notes/today.md", "remote", "20260621T101000Z", "ver_remote")).toBe(
  "notes/today.remote-conflict-20260621T101000Z-ver_remo.md",
)
```

- [ ] **Step 3: Run RED**

```bash
npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/merge.test.ts
```

Expected: fail until function signatures use `DriveClock` / compact timestamp.

- [ ] **Step 4: Wire state and merge**

In `state.ts`, import `DriveClock` and `driveIsoTimestamp`:

```ts
import { driveIsoTimestamp, type DriveClock } from "./clock.js"
```

Change signatures:

```ts
export async function writeDriveState(root: string, state: DriveState, clock?: DriveClock): Promise<void>
export async function initDriveState(root: string, libraryId: string, clock?: DriveClock): Promise<DriveState>
```

Use:

```ts
updated_at: driveIsoTimestamp(clock)
const now = driveIsoTimestamp(clock)
```

In `merge.ts`, change:

```ts
export function conflictCopyPath(path: string, side: ConflictSide, timestamp: string, versionId: string): string
```

and remove `Date#toISOString()` formatting from that function.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/merge.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit state/merge wiring**

```bash
git add src/handwritten/commands/drive/state.ts src/handwritten/commands/drive/merge.ts test/handwritten/drive/state.test.ts test/handwritten/drive/merge.test.ts
git commit -m "refactor(drive): use clock helper for state timestamps"
```

## Task 3: Sync And Realtime Wiring

**Files:**
- Modify: `src/handwritten/commands/drive/sync.ts`
- Modify: `src/handwritten/commands/drive/realtime.ts`
- Modify: `test/handwritten/drive/sync.test.ts`
- Modify: `test/handwritten/drive/realtime.test.ts`

- [ ] **Step 1: Update tests to inject fixed clocks**

In `sync.test.ts`, import `DateTime` and `DriveClock`, define:

```ts
const conflictClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00Z", { setZone: true }),
}
```

Replace conflict-copy `vi.useFakeTimers()` / `vi.setSystemTime()` wrappers with:

```ts
const first = await runDriveSyncOnce(root, api, conflictClock)
const second = await runDriveSyncOnce(root, api, conflictClock)
```

In `realtime.test.ts`, replace `now: () => new Date("...")` with:

```ts
clock: { now: () => DateTime.fromISO("2026-06-21T10:00:00.000Z", { setZone: true }) }
```

- [ ] **Step 2: Run RED**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/realtime.test.ts
```

Expected: fail until `runDriveSyncOnce()` and realtime source accept `DriveClock`.

- [ ] **Step 3: Wire sync**

In `sync.ts`, import:

```ts
import { driveConflictTimestamp, driveIsoTimestamp, systemDriveClock, type DriveClock } from "./clock.js"
```

Change:

```ts
export async function runDriveSyncOnce(root: string, api?: DriveSyncApi, clock: DriveClock = systemDriveClock): Promise<DriveSyncSummary>
```

Thread `clock` through `processPath()`, `tryResolveConflict()`, `recordRemoteConflictCopy()`, `writeConflictCopy()`, `stateEntryFromRemote()`, `recordConflict()`, `recordTypedConflict()`, and `conflict()`. Replace timestamp creation with:

```ts
detected_at: driveIsoTimestamp(clock)
last_synced_at: driveIsoTimestamp(clock)
const baseCopyPath = conflictCopyPath(path, side, driveConflictTimestamp(clock), versionId)
```

- [ ] **Step 4: Wire realtime**

In `realtime.ts`, import:

```ts
import { driveIsoTimestamp, systemDriveClock, type DriveClock } from "./clock.js"
```

Change args:

```ts
clock?: DriveClock
```

Use:

```ts
const clock = args.clock ?? systemDriveClock
const timestamp = driveIsoTimestamp(clock)
```

for `last_connected_at` and `last_event_at`.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/realtime.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit sync/realtime wiring**

```bash
git add src/handwritten/commands/drive/sync.ts src/handwritten/commands/drive/realtime.ts test/handwritten/drive/sync.test.ts test/handwritten/drive/realtime.test.ts
git commit -m "refactor(drive): inject clock into sync and realtime"
```

## Task 4: Final Verification And PR

**Files:**
- Verify all changed files.

- [ ] **Step 1: Search for forbidden timestamp creation**

```bash
rg -n "new Date\\(\\)\\.toISOString|new Date\\(|toISOString\\(\\)" src/handwritten/commands/drive test/handwritten/drive
```

Expected: no Drive production timestamp generation remains outside `clock.ts`; `Date.now()` may remain in `watch.ts`.

- [ ] **Step 2: Focused checks**

```bash
npm test -- test/handwritten/drive/clock.test.ts test/handwritten/drive/state.test.ts test/handwritten/drive/sync.test.ts test/handwritten/drive/merge.test.ts test/handwritten/drive/realtime.test.ts
npm run typecheck
git diff --check
```

Expected: pass.

- [ ] **Step 3: Full suite**

```bash
env -u NO_COLOR FORCE_COLOR=1 npm test
```

Expected: full Vitest suite passes.

- [ ] **Step 4: Ponytail review**

Review changed files for over-engineering. Quick cuts should be committed; non-trivial follow-up belongs in the WSPC todo comment.

- [ ] **Step 5: Draft PR and todo comment**

```bash
git fetch origin main
git rebase origin/main
git push -u origin codex/refactor-drive-clock-helper
gh pr create --draft --base main --head codex/refactor-drive-clock-helper --title "Refactor Drive timestamp creation behind clock helper" --body-file /tmp/drive-clock-helper-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVNAS7C1VHJSQF6D5RCE3R58 "<summary>"
```

Expected: draft PR includes Todo ID, spec path, plan path, verification commands, and e2e-smoke note.

## Self-Review

Spec coverage: plan covers `state.ts`、`sync.ts`、`merge.ts`、`realtime.ts` timestamp generation, conflict filename timestamp, fixed clock tests, and leaves `watch.ts` `Date.now()` alone.

Placeholder scan: no deferred placeholders remain.

Type consistency: all injection uses one `DriveClock` interface returning Luxon `DateTime`; no class or repo-wide clock abstraction is introduced.

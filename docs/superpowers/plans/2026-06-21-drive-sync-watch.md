# Drive Sync Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作 `wspc drive watch [path]`，用本機 watcher 排程既有 `runDriveSyncOnce(root)`，不新增第二套同步邏輯。

**Architecture:** 新增 `src/handwritten/commands/drive/watch.ts`，把長跑 watch、debounce、single-flight、retry/backoff 做成可注入的小 module；CLI command 只負責 resolve path、render output、等待 process signal。`src/cli.ts` 只新增 mount，避免改動 generated command tree。

**Tech Stack:** TypeScript、Commander、Vitest、Node fs/path timers、`chokidar`。

---

## File Structure

- Modify: `package.json`、`package-lock.json`，加入 `chokidar` runtime dependency。
- Create: `src/handwritten/commands/drive/watch.ts`，提供 `runDriveWatch()`、`driveWatchCommand()` 與可測 scheduler helper。
- Modify: `src/cli.ts`，把 `watch` 掛到 `drive` subtree，並避免和未來 generated `drive watch` 重複。
- Create: `test/handwritten/drive/watch.test.ts`，覆蓋 command mount、startup sync、debounce、single-flight、ignore internal files、retry、auth stop、conflict keepalive。

### Task 1: Add Chokidar Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dependency**

Run:

```bash
npm install chokidar
```

Expected: `package.json` gains `"chokidar"` under dependencies and `package-lock.json` updates.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(drive): add watch dependency"
```

### Task 2: Write Watch Scheduler Tests

**Files:**
- Create: `test/handwritten/drive/watch.test.ts`
- Create in Task 3: `src/handwritten/commands/drive/watch.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add this test skeleton and the first assertions:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { runDriveWatch, type DriveWatchSource } from "../../../src/handwritten/commands/drive/watch.js"

const readState = async () => ({ library_id: "lib_1" }) as any

function fakeSource(): DriveWatchSource & { emit(path: string): void } {
  let handler: ((path: string) => void) | undefined
  return {
    onChange(next) {
      handler = next
    },
    async close() {},
    emit(path: string) {
      handler?.(path)
    },
  }
}

describe("drive watch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("runs one sync on startup", async () => {
    const source = fakeSource()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))

    await runDriveWatch("/tmp/root", { source, runSync, readState, once: true })

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledWith("/tmp/root")
  })

  it("debounces multiple file events into one sync", async () => {
    const source = fakeSource()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, once: true })

    source.emit("a.txt")
    source.emit("b.txt")
    await vi.advanceTimersByTimeAsync(499)
    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await watching

    expect(runSync).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- test/handwritten/drive/watch.test.ts
```

Expected: FAIL because `src/handwritten/commands/drive/watch.ts` does not exist.

### Task 3: Implement Minimal Watch Module

**Files:**
- Create: `src/handwritten/commands/drive/watch.ts`

- [ ] **Step 1: Add the minimal implementation**

Create `watch.ts` with:

```ts
import { Command } from "commander"
import chokidar from "chokidar"
import { resolve, relative } from "node:path"
import { readDriveState, DRIVE_DIR } from "./state.js"
import { runDriveSyncOnce, type DriveSyncSummary } from "./sync.js"
import { render } from "../../output/render.js"

export interface DriveWatchSource {
  onChange(handler: (path: string) => void): void
  close(): Promise<void>
}

export interface DriveWatchOptions {
  source?: DriveWatchSource
  readState?: typeof readDriveState
  runSync?: (root: string) => Promise<DriveSyncSummary>
  once?: boolean
  debounceMs?: number
  sleep?: (ms: number) => Promise<void>
  onEvent?: (event: unknown) => void
}

export async function runDriveWatch(root: string, options: DriveWatchOptions = {}): Promise<void> {
  const state = await (options.readState ?? readDriveState)(root)
  const runSync = options.runSync ?? runDriveSyncOnce
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)))
  const debounceMs = options.debounceMs ?? 500
  const source = options.source ?? createChokidarSource(root)
  const emit = options.onEvent ?? ((event) => render({ kind: "drive_watch", display: { shape: "object" } }, event))
  let timer: NodeJS.Timeout | undefined
  let running = false
  let rerunRequested = false
  let backoffMs = 1000

  async function requestSync(): Promise<void> {
    if (running) {
      rerunRequested = true
      return
    }
    running = true
    try {
      do {
        rerunRequested = false
        try {
          const summary = await runSync(root)
          emit({ kind: "drive_sync_once", ...summary })
          backoffMs = 1000
          if (summary.conflicts > 0 || summary.errors > 0) return
        } catch (error) {
          if (isAuthError(error) || isFatalWatchError(error)) throw error
          emit({ kind: "drive_watch_retry", delay_ms: backoffMs, error: errorMessage(error) })
          await sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, 60_000)
          rerunRequested = true
        }
      } while (rerunRequested)
    } finally {
      running = false
    }
  }

  source.onChange((path) => {
    if (isDriveInternalPath(root, path)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void requestSync(), debounceMs)
  })
  emit({ kind: "drive_watch_started", root, library_id: state.library_id })
  await requestSync()
  if (options.once) {
    await source.close()
    return
  }
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", resolveStop)
    process.once("SIGTERM", resolveStop)
  })
  await source.close()
}

export function driveWatchCommand(options: DriveWatchOptions = {}): Command {
  return new Command("watch")
    .description("Watch a bound Drive folder and sync local changes")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string) => {
      await runDriveWatch(resolve(path), options)
    })
}

function createChokidarSource(root: string): DriveWatchSource {
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (path) => isDriveInternalPath(root, path),
  })
  return {
    onChange(handler) {
      watcher.on("all", (_event, path) => handler(path))
    },
    async close() {
      await watcher.close()
    },
  }
}

function isDriveInternalPath(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === DRIVE_DIR || rel.startsWith(`${DRIVE_DIR}/`) || rel.startsWith(`${DRIVE_DIR}\\`)
}

function isAuthError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  const message = errorMessage(error)
  return code === "WSPC_AUTH_EXPIRED" || /\b(401|403|auth|authorization)\b/i.test(message)
}

function isFatalWatchError(error: unknown): boolean {
  return /unsupported .*state\.json schema|sync lock already exists/i.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

- [ ] **Step 2: Run focused tests and verify GREEN**

Run:

```bash
npm test -- test/handwritten/drive/watch.test.ts
```

Expected: PASS for the first scheduler tests.

- [ ] **Step 3: Commit**

```bash
git add src/handwritten/commands/drive/watch.ts test/handwritten/drive/watch.test.ts
git commit -m "feat(drive): add watch sync scheduler"
```

### Task 4: Cover Watch Edge Cases

**Files:**
- Modify: `test/handwritten/drive/watch.test.ts`
- Modify: `src/handwritten/commands/drive/watch.ts`

- [ ] **Step 1: Add tests for single-flight, internal ignore, retry, auth stop, conflict keepalive**

Append tests that assert:

```ts
it("runs one trailing sync after events during an active sync", async () => {
  const source = fakeSource()
  let release!: () => void
  const runSync = vi.fn(() => new Promise<any>((resolve) => {
    release = () => resolve({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] })
  }))
  const watching = runDriveWatch("/tmp/root", { source, runSync, readState, once: true })
  source.emit("a.txt")
  await vi.advanceTimersByTimeAsync(500)
  source.emit("b.txt")
  release()
  await watching
  expect(runSync).toHaveBeenCalledTimes(2)
})

it("ignores .wspc-drive events", async () => {
  const source = fakeSource()
  const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
  const watching = runDriveWatch("/tmp/root", { source, runSync, readState, once: true })
  source.emit("/tmp/root/.wspc-drive/state.json")
  await vi.advanceTimersByTimeAsync(500)
  await watching
  expect(runSync).toHaveBeenCalledTimes(1)
})

it("backs off and retries transient errors", async () => {
  const source = fakeSource()
  const sleep = vi.fn(async () => undefined)
  const runSync = vi.fn()
    .mockRejectedValueOnce(new Error("HTTP 500: boom"))
    .mockResolvedValueOnce({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] })
  await runDriveWatch("/tmp/root", { source, runSync, readState, sleep, once: true })
  expect(sleep).toHaveBeenCalledWith(1000)
  expect(runSync).toHaveBeenCalledTimes(2)
})

it("throws auth errors without retrying forever", async () => {
  const source = fakeSource()
  const error = Object.assign(new Error("HTTP 401: login required"), { code: "WSPC_AUTH_EXPIRED" })
  const runSync = vi.fn(async () => { throw error })
  await expect(runDriveWatch("/tmp/root", { source, runSync, readState, once: true })).rejects.toThrow("login required")
  expect(runSync).toHaveBeenCalledTimes(1)
})

it("keeps running after conflict summaries", async () => {
  const source = fakeSource()
  const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 1, errors: 0, paths: [] }))
  await runDriveWatch("/tmp/root", { source, runSync, readState, once: true })
  expect(runSync).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests and fix the smallest failing branch**

Run:

```bash
npm test -- test/handwritten/drive/watch.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/handwritten/commands/drive/watch.ts test/handwritten/drive/watch.test.ts
git commit -m "test(drive): cover watch scheduling edges"
```

### Task 5: Mount `drive watch`

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/handwritten/drive/bind.test.ts`

- [ ] **Step 1: Write failing mount tests**

Add expectations to existing drive mount tests:

```ts
expect(res.stdout).toContain("watch")
expect(res.stdout).toContain("Watch a bound Drive folder and sync local changes")
```

and for generated tree:

```ts
expect(driveRoots[0]!.commands.map((cmd) => cmd.name())).toEqual(["generated", "bind", "sync", "watch"])
```

Add a duplicate guard:

```ts
it("does not duplicate a generated drive watch command", async () => {
  const { mountDriveCommands } = await import("../../../src/cli.js")
  const program = new Command("wspc")
  const drive = new Command("drive").description("Generated Drive commands")
  drive.command("watch")
  program.addCommand(drive)
  mountDriveCommands(program)
  expect(drive.commands.filter((cmd) => cmd.name() === "watch")).toHaveLength(1)
})
```

- [ ] **Step 2: Mount the command**

In `src/cli.ts`, import `driveWatchCommand` and add:

```ts
if (!drive.commands.some((c) => c.name() === "watch")) {
  drive.addCommand(driveWatchCommand())
}
```

- [ ] **Step 3: Run focused tests**

```bash
npm test -- test/handwritten/drive/bind.test.ts test/handwritten/drive/watch.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts test/handwritten/drive/bind.test.ts
git commit -m "feat(drive): mount watch command"
```

### Task 6: Verify Whole Change

**Files:**
- All changed files

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit any final fixes**

```bash
git status --short
git add <fixed-files>
git commit -m "fix(drive): polish watch behavior"
```

Skip this commit if `git status --short` is clean.

## Self-Review

- Spec coverage: startup sync, chokidar backend, `.wspc-drive/` ignore, debounce, single-flight rerun, transient retry, auth stop, conflict keepalive, `drive watch [path]`, JSON/human render path, generated-command duplicate guard are covered.
- Deliberate deferrals: realtime, polling, rename detection, operation queue, ignore rules, stale-lock recovery remain out of scope per spec.
- Type consistency: `DriveWatchSource`, `DriveWatchOptions`, and `DriveSyncSummary` names are introduced before use and reused consistently.

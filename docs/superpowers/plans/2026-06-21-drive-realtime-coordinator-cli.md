# Drive Realtime Coordinator CLI 實作計畫

> **給 agentic workers：** 必要 sub-skill：使用 `superpowers:subagent-driven-development`（建議）或 `superpowers:executing-plans` 逐 task 實作本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 讓既有 `wspc drive watch [path]` 在 foreground 模式同時監看本機檔案事件與 Drive realtime WebSocket event，並把 remote event 當成 full sync hint。

**架構：** 保留 `runDriveSyncOnce(root)` 作為唯一 correctness boundary。`watch.ts` 繼續持有 sync scheduler，新增最小 realtime source 只負責連線、message parse、cursor metadata、reconnect 與低敏 event emit。State 沿用 `schema_version: 1`，新增 optional `realtime` metadata 與 client id helper。

**技術：** TypeScript、Node 24 native `WebSocket`、Vitest fake timers、既有 `loadAuthedFetch()` / Drive watch injection pattern。

---

## 檔案結構

- Modify: `src/handwritten/commands/drive/state.ts`
  - 擴充 `DriveState.realtime` 型別、schema guard、`ensureDriveRealtimeState()` helper。
- Create: `src/handwritten/commands/drive/realtime.ts`
  - URL 推導、message parse、low-sensitive error helpers、native WebSocket source factory。
- Modify: `src/handwritten/commands/drive/watch.ts`
  - 將 local source 和 realtime source 接到同一個 scheduler。
- Modify: `test/handwritten/drive/state.test.ts`
  - 驗證 realtime metadata schema 與 client id persistence。
- Create: `test/handwritten/drive/realtime.test.ts`
  - 驗證 URL/message/reconnect helper，不碰真 WebSocket server。
- Modify: `test/handwritten/drive/watch.test.ts`
  - 驗證 local/realtime 共用 queue、remote debounce、auth failure、realtime close 後 local watch 仍運作。
- Modify: `README.md`
  - 補一小段 Drive watch realtime 行為與限制。

## Task 1：State Realtime Metadata

**Files:**
- Modify: `src/handwritten/commands/drive/state.ts`
- Modify: `test/handwritten/drive/state.test.ts`

- [ ] **Step 1: Write failing state metadata tests**

Add these tests to `test/handwritten/drive/state.test.ts`:

```ts
it("accepts realtime metadata while preserving schema version 1", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-realtime-"))
  await mkdir(join(root, ".wspc-drive"), { recursive: true })
  await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
    schema_version: 1,
    library_id: "lib_1",
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    entries: {},
    conflicts: {},
    realtime: {
      client_id: "drvcli_abc123",
      last_cursor: "000123",
      last_connected_at: "2026-06-21T10:00:00.000Z",
      last_event_at: "2026-06-21T10:01:00.000Z",
    },
  }))

  expect((await readDriveState(root)).realtime).toMatchObject({
    client_id: "drvcli_abc123",
    last_cursor: "000123",
  })
})

it("rejects malformed realtime metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-realtime-"))
  await mkdir(join(root, ".wspc-drive"), { recursive: true })
  await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
    schema_version: 1,
    library_id: "lib_1",
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    entries: {},
    conflicts: {},
    realtime: { client_id: "host-petes-macbook", last_cursor: 42 },
  }))

  await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
})

it("creates an opaque realtime client id when missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-realtime-client-"))
  await initDriveState(root, "lib_1")

  const state = await ensureDriveRealtimeState(root)

  expect(state.realtime?.client_id).toMatch(/^drvcli_[A-Za-z0-9_-]+$/)
  expect((await readDriveState(root)).realtime?.client_id).toBe(state.realtime?.client_id)
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/state.test.ts
```

Expected: FAIL because `DriveState.realtime` and `ensureDriveRealtimeState()` do not exist.

- [ ] **Step 3: Implement minimal state helper**

In `src/handwritten/commands/drive/state.ts`, add:

```ts
export interface DriveRealtimeState {
  client_id: string
  last_cursor?: string
  last_connected_at?: string
  last_event_at?: string
}

export interface DriveState {
  schema_version: 1
  library_id: string
  created_at: string
  updated_at: string
  entries: Record<string, DriveStateEntry>
  conflicts: Record<string, DriveConflict>
  realtime?: DriveRealtimeState
}

export async function ensureDriveRealtimeState(root: string): Promise<DriveState> {
  const state = await readDriveState(root)
  if (state.realtime?.client_id !== undefined) return state
  const nextState: DriveState = {
    ...state,
    realtime: {
      ...state.realtime,
      client_id: `drvcli_${randomUUID().replace(/-/g, "")}`,
    },
  }
  await writeDriveState(root, nextState)
  return nextState
}
```

Update `isValidDriveState()` to accept optional `realtime` only when every field is a string and `client_id` starts with `drvcli_`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/state.test.ts
npm run typecheck
```

Commit:

```bash
git add src/handwritten/commands/drive/state.ts test/handwritten/drive/state.test.ts
git commit -m "feat(drive): persist realtime watch metadata"
```

## Task 2：Realtime URL 與 Message Helpers

**Files:**
- Create: `src/handwritten/commands/drive/realtime.ts`
- Create: `test/handwritten/drive/realtime.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `test/handwritten/drive/realtime.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildDriveRealtimeUrl, parseDriveRealtimeMessage, redactedRealtimeError } from "../../../src/handwritten/commands/drive/realtime.js"

describe("drive realtime helpers", () => {
  it("builds ws and wss urls without token data", () => {
    expect(buildDriveRealtimeUrl("https://api.wspc.ai", "lib_1", { client_id: "drvcli_abc" }).toString()).toBe(
      "wss://api.wspc.ai/drive/libraries/lib_1/realtime?client_id=drvcli_abc",
    )
    expect(buildDriveRealtimeUrl("http://127.0.0.1:8787", "lib/a", {
      client_id: "drvcli_abc",
      last_cursor: "cur_1",
    }).toString()).toBe(
      "ws://127.0.0.1:8787/drive/libraries/lib%2Fa/realtime?cursor=cur_1&client_id=drvcli_abc",
    )
  })

  it("parses known messages and ignores unknown messages", () => {
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "ready", cursor: "c2", replayed: 1 }))).toEqual({
      type: "ready",
      cursor: "c2",
      replayed: 1,
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "library_changed", cursor: "c3", path: "notes.md" }))).toEqual({
      type: "library_changed",
      cursor: "c3",
      path: "notes.md",
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "mystery", token: "secret" }))).toEqual({
      type: "unknown",
      message_type: "mystery",
    })
  })

  it("redacts realtime errors", () => {
    expect(redactedRealtimeError(new Error("HTTP 403: Bearer secret-token"))).toBe("HTTP 403")
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
```

Expected: FAIL because `realtime.ts` does not exist.

- [ ] **Step 3: Implement minimal helper module**

Create `src/handwritten/commands/drive/realtime.ts`:

```ts
import type { DriveRealtimeState } from "./state.js"

export type DriveRealtimeMessage =
  | { type: "ready"; cursor?: string; replayed: number }
  | { type: "library_changed"; cursor?: string; path?: string }
  | { type: "resync_required"; cursor?: string; reason?: string }
  | { type: "error"; code?: string; message?: string }
  | { type: "unknown"; message_type?: string }

export function buildDriveRealtimeUrl(baseUrl: string, libraryId: string, realtime: DriveRealtimeState): URL {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  url.pathname = `/drive/libraries/${encodeURIComponent(libraryId)}/realtime`
  url.search = ""
  if (realtime.last_cursor !== undefined) url.searchParams.set("cursor", realtime.last_cursor)
  url.searchParams.set("client_id", realtime.client_id)
  return url
}

export function parseDriveRealtimeMessage(raw: string): DriveRealtimeMessage {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { type: "unknown" }
  }
  if (typeof value !== "object" || value === null) return { type: "unknown" }
  const record = value as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : undefined
  const cursor = typeof record.cursor === "string" ? record.cursor : undefined
  if (type === "ready") return { type, cursor, replayed: typeof record.replayed === "number" ? record.replayed : 0 }
  if (type === "library_changed") {
    return { type, cursor, ...(typeof record.path === "string" ? { path: record.path } : {}) }
  }
  if (type === "resync_required") {
    return { type, cursor, ...(typeof record.reason === "string" ? { reason: record.reason } : {}) }
  }
  if (type === "error") {
    return {
      type,
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(typeof record.message === "string" ? { message: redactedRealtimeError(record.message) } : {}),
    }
  }
  return { type: "unknown", ...(type ? { message_type: type } : {}) }
}

export function redactedRealtimeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const status = text.match(/\bHTTP\s+(401|403|429|5\d\d)\b/i)
  if (status) return `HTTP ${status[1]}`
  if (/\bauth|authorization\b/i.test(text)) return "auth failed"
  if (/\bnetwork|fetch|close\b/i.test(text)) return "network error"
  return "realtime error"
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
npm run typecheck
```

Commit:

```bash
git add src/handwritten/commands/drive/realtime.ts test/handwritten/drive/realtime.test.ts
git commit -m "feat(drive): add realtime watch helpers"
```

## Task 3：Watch Scheduler 整合

**Files:**
- Modify: `src/handwritten/commands/drive/watch.ts`
- Modify: `test/handwritten/drive/watch.test.ts`

- [ ] **Step 1: Write failing watch integration tests**

Extend `test/handwritten/drive/watch.test.ts` with a fake realtime source:

```ts
type FakeRealtimeSource = {
  start: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  emitEvent(event: { debounce_ms?: number; immediate?: boolean; cursor?: string; path?: string }): void
  emitAuthFailed(): void
}

function fakeRealtimeSource(): FakeRealtimeSource {
  let onEvent: ((event: { debounce_ms?: number; immediate?: boolean; cursor?: string; path?: string }) => void) | undefined
  let onAuthFailed: (() => void) | undefined
  return {
    start: vi.fn(async (handlers: {
      onEvent: typeof onEvent
      onAuthFailed: typeof onAuthFailed
    }) => {
      onEvent = handlers.onEvent
      onAuthFailed = handlers.onAuthFailed
    }),
    close: vi.fn(async () => {}),
    emitEvent(event) {
      onEvent?.(event)
    },
    emitAuthFailed() {
      onAuthFailed?.()
    },
  }
}
```

Add tests:

```ts
it("debounces remote realtime events through the same sync queue", async () => {
  const source = fakeSource()
  const realtime = fakeRealtimeSource()
  const onEvent = vi.fn()
  const runSync = vi.fn(async () => syncSummary())
  const watching = runDriveWatch("/tmp/root", { source, realtimeSource: realtime, runSync, readState, onEvent })
  await source.waitForSubscription()
  await Promise.resolve()
  await Promise.resolve()

  realtime.emitEvent({ debounce_ms: 2000, cursor: "c1", path: "notes.md" })
  await vi.advanceTimersByTimeAsync(1999)
  expect(runSync).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)

  expect(runSync).toHaveBeenCalledTimes(2)
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "drive_realtime_event", path: "notes.md" }))
  process.emit("SIGINT")
  await watching
})

it("coalesces local and remote events into one pending sync", async () => {
  const source = fakeSource()
  const realtime = fakeRealtimeSource()
  const onEvent = vi.fn()
  const runSync = vi.fn(async () => syncSummary())
  const watching = runDriveWatch("/tmp/root", { source, realtimeSource: realtime, runSync, readState, onEvent })
  await source.waitForSubscription()
  await Promise.resolve()
  await Promise.resolve()

  source.emit("a.txt")
  realtime.emitEvent({ debounce_ms: 2000, cursor: "c1" })
  await vi.advanceTimersByTimeAsync(500)

  expect(runSync).toHaveBeenCalledTimes(2)
  process.emit("SIGINT")
  await watching
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/watch.test.ts
```

Expected: FAIL because `realtimeSource` option does not exist.

- [ ] **Step 3: Implement realtime source option and shared scheduler**

In `watch.ts`, add:

```ts
export interface DriveRealtimeSource {
  start(handlers: {
    onConnected: () => void
    onEvent: (event: { debounce_ms?: number; immediate?: boolean; cursor?: string; path?: string; reason?: string }) => void
    onReconnect: (delayMs: number, error: string) => void
    onAuthFailed: (error: string) => void
  }): Promise<void>
  close(): Promise<void>
}

export interface DriveWatchOptions {
  source?: DriveWatchSource
  realtimeSource?: DriveRealtimeSource
  readState?: typeof readDriveState
  runSync?: (root: string) => Promise<DriveSyncSummary>
  once?: boolean
  debounceMs?: number
  remoteDebounceMs?: number
  onEvent?: (event: unknown) => void
}
```

Refactor local `source.onChange()` to call one shared `scheduleSync(delayMs)` helper. Add `realtimeSource.start()` after `drive_watch_started`; realtime `onEvent` emits `drive_realtime_event` and schedules `requestSync()` with `remoteDebounceMs ?? 2000`, or immediate when requested.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/watch.test.ts
npm run typecheck
```

Commit:

```bash
git add src/handwritten/commands/drive/watch.ts test/handwritten/drive/watch.test.ts
git commit -m "feat(drive): route realtime events through watch scheduler"
```

## Task 4：Native WebSocket Source、Cursor 與 Reconnect

**Files:**
- Modify: `src/handwritten/commands/drive/realtime.ts`
- Modify: `src/handwritten/commands/drive/watch.ts`
- Modify: `test/handwritten/drive/realtime.test.ts`
- Modify: `test/handwritten/drive/watch.test.ts`

- [ ] **Step 1: Write failing reconnect and cursor tests**

In `test/handwritten/drive/realtime.test.ts`, add tests around a fake WebSocket constructor:

```ts
it("updates cursor for ready and library_changed messages", async () => {
  const updates: string[] = []
  const source = createDriveRealtimeSource({
    baseUrl: "https://api.wspc.ai",
    libraryId: "lib_1",
    realtime: { client_id: "drvcli_abc" },
    writeRealtimeState: async (next) => { if (next.last_cursor) updates.push(next.last_cursor) },
    connect: fakeConnector([
      { type: "open" },
      { type: "message", data: JSON.stringify({ type: "ready", cursor: "c1", replayed: 1 }) },
      { type: "message", data: JSON.stringify({ type: "library_changed", cursor: "c2", path: "notes.md" }) },
    ]),
  })
  const events: unknown[] = []

  await source.start({
    onConnected: () => events.push("connected"),
    onEvent: (event) => events.push(event),
    onReconnect: () => {},
    onAuthFailed: () => {},
  })

  expect(updates).toEqual(["c1", "c2"])
  expect(events).toContainEqual(expect.objectContaining({ path: "notes.md" }))
})
```

Also add a watch test:

```ts
it("keeps local watch running after realtime auth failure", async () => {
  const source = fakeSource()
  const realtime = fakeRealtimeSource()
  const onEvent = vi.fn()
  const runSync = vi.fn(async () => syncSummary())
  const watching = runDriveWatch("/tmp/root", { source, realtimeSource: realtime, runSync, readState, onEvent })
  await source.waitForSubscription()
  await Promise.resolve()

  realtime.emitAuthFailed()
  source.emit("local.txt")
  await vi.advanceTimersByTimeAsync(500)

  expect(runSync).toHaveBeenCalledTimes(2)
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "drive_realtime_auth_failed" }))
  process.emit("SIGINT")
  await watching
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts test/handwritten/drive/watch.test.ts
```

Expected: FAIL because `createDriveRealtimeSource()` and auth failure handling are incomplete.

- [ ] **Step 3: Implement native source with injection**

In `realtime.ts`, add a tiny source factory. Keep the connector injectable so tests do not need a server:

```ts
export type DriveRealtimeConnector = (url: URL, handlers: {
  open: () => void
  message: (data: string) => void
  close: (error?: unknown) => void
}) => { close: () => void }

export function createDriveRealtimeSource(args: {
  baseUrl: string
  libraryId: string
  realtime: DriveRealtimeState
  writeRealtimeState: (next: DriveRealtimeState) => Promise<void>
  connect?: DriveRealtimeConnector
  now?: () => Date
}): DriveRealtimeSource {
  // Use globalThis.WebSocket in the default connector.
  // Reconnect with 1s, 2s, 4s ... max 60s.
  // Parse messages and call watch handlers; never touch local files or entries.
}
```

Default connector:

```ts
function nativeWebSocketConnector(url: URL, handlers: Parameters<DriveRealtimeConnector>[1]) {
  const ws = new WebSocket(url)
  ws.addEventListener("open", handlers.open)
  ws.addEventListener("message", (event) => handlers.message(String(event.data)))
  ws.addEventListener("close", () => handlers.close())
  ws.addEventListener("error", () => handlers.close(new Error("network error")))
  return { close: () => ws.close() }
}
```

In `watch.ts`, when no `options.realtimeSource` is provided and `options.once !== true`, call `ensureDriveRealtimeState(root)` and `loadAuthedFetch()` to create the production source. Keep tests injecting `realtimeSource` so they do not read config.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts test/handwritten/drive/watch.test.ts test/handwritten/drive/state.test.ts
npm run typecheck
```

Commit:

```bash
git add src/handwritten/commands/drive/realtime.ts src/handwritten/commands/drive/watch.ts test/handwritten/drive/realtime.test.ts test/handwritten/drive/watch.test.ts
git commit -m "feat(drive): connect watch to realtime coordinator"
```

## Task 5：Output、README 與 Final Verification

**Files:**
- Modify: `README.md`
- Modify: `test/handwritten/drive/watch.test.ts`

- [ ] **Step 1: Add output and README tests**

Add or adjust watch tests to assert output events:

```ts
expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "drive_realtime_connected" }))
expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
  kind: "drive_realtime_event",
  message: "remote update received; syncing",
}))
expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "drive_realtime_reconnecting" }))
```

Add a short README paragraph under Drive watch:

```md
`wspc drive watch [path]` also connects to the Drive realtime coordinator for the bound library. Realtime events are sync hints only: the CLI still runs a full `drive sync once` pass before changing local files or state. If realtime reconnect fails, local file watching continues and the CLI reports reconnect attempts.
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run build
env -u NO_COLOR TERM=xterm-256color npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md test/handwritten/drive/watch.test.ts
git commit -m "docs(drive): document realtime watch behavior"
```

## 最終驗證

Before PR:

```bash
npm run typecheck
npm run build
env -u NO_COLOR TERM=xterm-256color npm test
```

Do not run a real WSPC realtime e2e smoke locally; this plan uses fake realtime connectors and existing sync tests. Real provider smoke belongs in CI or a manual backend-integrated pass.

## 自我檢查

- Spec coverage: state metadata, URL building, no token in state/logs, message handling, shared scheduler, debounce, reconnect/auth failure, cursor persistence, output, safety and no daemon/polling are mapped to tasks above.
- Placeholder scan: no placeholder markers or undefined later function names remain; `createDriveRealtimeSource`, `buildDriveRealtimeUrl`, and `parseDriveRealtimeMessage` are defined before use.
- Type consistency: `DriveRealtimeState`, `DriveRealtimeSource`, `DriveRealtimeConnector`, and watch event shapes use the same names across tasks.

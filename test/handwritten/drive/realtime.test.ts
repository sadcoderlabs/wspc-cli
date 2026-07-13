import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DateTime } from "luxon"
import {
  buildDriveRealtimeUrl,
  createDriveRealtimeSource,
  parseDriveRealtimeMessage,
  redactedRealtimeError,
  type DriveRealtimeConnector,
} from "../../../src/handwritten/commands/drive/realtime.js"
import type { DriveRealtimeState } from "../../../src/handwritten/commands/drive/state.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

type ConnectorHandlers = Parameters<DriveRealtimeConnector>[1]
type ConnectorInit = Parameters<DriveRealtimeConnector>[2]

function fakeConnector(): DriveRealtimeConnector & {
  connections: Array<{
    url: URL
    handlers: ConnectorHandlers
    init: ConnectorInit
    close: ReturnType<typeof vi.fn>
  }>
} {
  const connections: Array<{
    url: URL
    handlers: ConnectorHandlers
    init: ConnectorInit
    close: ReturnType<typeof vi.fn>
  }> = []
  const connect: DriveRealtimeConnector = (url, handlers, init) => {
    const connection = {
      url,
      handlers,
      init,
      close: vi.fn(),
    }
    connections.push(connection)
    return { close: connection.close }
  }
  return Object.assign(connect, { connections })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function realtimeHandlers(events: unknown[] = []) {
  return {
    onConnected: vi.fn(() => events.push("connected")),
    onEvent: vi.fn((event) => events.push(event)),
    onReconnect: vi.fn((delayMs, error) => events.push({ reconnect: delayMs, error })),
    onAuthFailed: vi.fn((error) => events.push({ authFailed: error })),
    onWarning: vi.fn((warning) => events.push({ warning })),
  }
}

function sourceArgs(overrides: Partial<{
  realtime: DriveRealtimeState
  writeRealtimeState: (next: DriveRealtimeState) => Promise<void>
  connect: DriveRealtimeConnector
  clock: DriveClock
  headers: HeadersInit | (() => Promise<HeadersInit>)
}> = {}) {
  return {
    baseUrl: "https://api.wspc.ai",
    libraryId: "lib_1",
    realtime: { client_id: "drvcli_abc", ...overrides.realtime },
    writeRealtimeState: overrides.writeRealtimeState ?? (async () => {}),
    connect: overrides.connect,
    clock: overrides.clock,
    headers: overrides.headers,
  }
}

describe("drive realtime helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("builds websocket urls from api urls without token data", () => {
    expect(buildDriveRealtimeUrl("https://api.wspc.ai", "lib_1", { client_id: "drvcli_abc" }).toString()).toBe(
      "wss://api.wspc.ai/drive/libraries/lib_1/realtime?client_id=drvcli_abc",
    )
    expect(buildDriveRealtimeUrl("http://127.0.0.1:8787", "lib/a", {
      client_id: "drvcli_abc",
      last_cursor: "cur_1",
    }).toString()).toBe(
      "ws://127.0.0.1:8787/drive/libraries/lib%2Fa/realtime?cursor=cur_1&client_id=drvcli_abc",
    )

    const url = buildDriveRealtimeUrl("https://api.wspc.ai?token=secret-token#token=secret-fragment", "lib_1", {
      client_id: "drvcli_abc",
    })
    expect(url.searchParams.get("client_id")).toBe("drvcli_abc")
    expect(url.searchParams.has("cursor")).toBe(false)
    expect(url.searchParams.has("token")).toBe(false)
    expect(url.hash).toBe("")
  })

  it("requires a realtime client id", () => {
    expect(() => buildDriveRealtimeUrl("https://api.wspc.ai", "lib_1", { client_id: "" })).toThrow(/client_id is required/)
  })

  it("parses known realtime messages", () => {
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
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "resync_required", cursor: "c4", reason: "cursor_invalid" }))).toEqual({
      type: "resync_required",
      cursor: "c4",
      reason: "cursor_invalid",
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({
      type: "error",
      code: "forbidden",
      message: "HTTP 403: Bearer secret-token",
    }))).toEqual({
      type: "error",
      code: "forbidden",
      message: "HTTP 403",
    })
  })

  it("returns unknown for invalid json and strips sensitive unknown fields", () => {
    expect(parseDriveRealtimeMessage("{")).toEqual({ type: "unknown" })
    expect(parseDriveRealtimeMessage(JSON.stringify({
      type: "mystery",
      token: "secret-token",
      refresh_token: "secret-refresh-token",
    }))).toEqual({
      type: "unknown",
      message_type: "mystery",
    })
  })

  it("redacts realtime errors", () => {
    expect(redactedRealtimeError(new Error("HTTP 403: Bearer secret-token"))).toBe("HTTP 403")
    expect(redactedRealtimeError(new Error("WebSocket network close: secret-token"))).toBe("network error")
  })

  it("appends a safe diagnostic code without leaking the message", () => {
    const reset = Object.assign(new Error("network down: wss://host/secret"), { code: "ECONNRESET" })
    expect(redactedRealtimeError(reset)).toBe("network error (ECONNRESET)")

    const closed = Object.assign(new Error("unexpected failure"), { code: 1006 })
    expect(redactedRealtimeError(closed)).toBe("realtime error (1006)")

    // Unsafe-looking codes (payload-shaped) are dropped, not surfaced.
    const leaky = Object.assign(new Error("boom"), { code: "Bearer secret-token" })
    expect(redactedRealtimeError(leaky)).toBe("realtime error")

    expect(redactedRealtimeError(new Error("opaque failure"))).toBe("realtime error")
  })

  it("connects and persists the last connected timestamp on open", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      clock: { now: () => DateTime.fromISO("2026-06-21T10:00:00.000Z", { setZone: true }) },
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.open()
    await flushPromises()

    expect(connect.connections[0]?.url.toString()).toBe(
      "wss://api.wspc.ai/drive/libraries/lib_1/realtime?client_id=drvcli_abc",
    )
    expect(updates).toEqual([{ client_id: "drvcli_abc", last_connected_at: "2026-06-21T10:00:00.000Z" }])
    expect(events).toEqual(["connected"])
  })

  it("passes auth headers to the connector without putting them in the url", async () => {
    const connect = fakeConnector()
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      headers: { authorization: "Bearer secret-token" },
    }))

    await source.start(realtimeHandlers())

    expect(connect.connections[0]?.init?.headers).toEqual({ authorization: "Bearer secret-token" })
    expect(connect.connections[0]?.url.toString()).not.toContain("secret-token")
  })

  it("persists ready replay cursors and emits a debounced replay event", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({ type: "ready", cursor: "c1", replayed: 2 }))
    await flushPromises()

    expect(updates).toEqual([{ client_id: "drvcli_abc", last_cursor: "c1" }])
    expect(events).toContainEqual({ debounce_ms: 2000, cursor: "c1", reason: "ready_replay" })
  })

  it("persists library_changed cursors and emits a debounced change event", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      clock: { now: () => DateTime.fromISO("2026-06-21T10:05:00.000Z", { setZone: true }) },
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "library_changed",
      cursor: "c2",
      path: "notes.md",
    }))
    await flushPromises()

    expect(updates).toEqual([{
      client_id: "drvcli_abc",
      last_cursor: "c2",
      last_event_at: "2026-06-21T10:05:00.000Z",
    }])
    expect(events).toContainEqual({ debounce_ms: 2000, cursor: "c2", path: "notes.md", reason: "library_changed" })
  })

  it("suppresses own-echo library_changed events but still advances the cursor", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      clock: { now: () => DateTime.fromISO("2026-06-21T10:05:00.000Z", { setZone: true }) },
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "library_changed",
      cursor: "c9",
      path: "notes.md",
      origin_client_id: "drvcli_abc",
    }))
    await flushPromises()

    expect(events).toEqual([])
    expect(updates).toEqual([{
      client_id: "drvcli_abc",
      last_cursor: "c9",
      last_event_at: "2026-06-21T10:05:00.000Z",
    }])
  })

  it("still emits library_changed from other clients", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "library_changed",
      cursor: "c10",
      origin_client_id: "drvcli_other",
    }))
    await flushPromises()

    expect(events).toContainEqual({ debounce_ms: 2000, cursor: "c10", reason: "library_changed" })
  })

  it("emits library_changed events even when cursor persistence is locked", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      writeRealtimeState: async () => {
        throw new Error("sync lock already exists")
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "library_changed",
      cursor: "c2",
      path: "notes.md",
    }))
    await flushPromises()

    expect(events).toContainEqual({ debounce_ms: 2000, cursor: "c2", path: "notes.md", reason: "library_changed" })
    expect(events).toContainEqual({ warning: "realtime error" })
    expect(events).not.toContainEqual({ reconnect: 1000, error: "realtime error" })
  })

  it("emits resync_required events immediately", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      clock: { now: () => DateTime.fromISO("2026-06-21T10:06:00.000Z", { setZone: true }) },
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "resync_required",
      cursor: "c3",
      reason: "server_gap",
    }))
    await flushPromises()

    expect(updates).toEqual([{
      client_id: "drvcli_abc",
      last_cursor: "c3",
      last_event_at: "2026-06-21T10:06:00.000Z",
    }])
    expect(events).toContainEqual({ immediate: true, cursor: "c3", reason: "server_gap" })
  })

  it("clears invalid cursors before persisting resync_required", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      realtime: { client_id: "drvcli_abc", last_cursor: "old" },
      clock: { now: () => DateTime.fromISO("2026-06-21T10:07:00.000Z", { setZone: true }) },
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "resync_required",
      reason: "cursor_invalid",
    }))
    await flushPromises()

    expect(updates).toEqual([{
      client_id: "drvcli_abc",
      last_event_at: "2026-06-21T10:07:00.000Z",
    }])
    expect(events).toContainEqual({ immediate: true, reason: "cursor_invalid" })
  })

  it("emits a low-sensitive warning for unknown realtime messages", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({ type: "mystery", token: "secret" }))
    await flushPromises()

    expect(updates).toEqual([])
    expect(events).toEqual([{ warning: "unknown realtime message" }])
  })

  it("emits a warning for non-auth error messages while keeping the socket open", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "error",
      code: "temporary_overload",
      message: "server included secret-token here",
    }))
    await flushPromises()

    expect(events).toEqual([{ warning: "realtime error" }])
    expect(connect.connections[0]?.close).not.toHaveBeenCalled()
    expect(connect.connections).toHaveLength(1)
  })

  it("emits reconnect on close and reconnects with exponential backoff", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.close(new Error("network close"))

    expect(events).toContainEqual({ reconnect: 1000, error: "network error" })
    expect(connect.connections).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(connect.connections).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(connect.connections).toHaveLength(2)
    connect.connections[1]?.handlers.close(new Error("network close"))
    expect(events).toContainEqual({ reconnect: 2000, error: "network error" })
  })

  it("stops reconnecting after auth errors", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.message(JSON.stringify({
      type: "error",
      code: "forbidden",
      message: "HTTP 403: Bearer secret-token",
    }))
    connect.connections[0]?.handlers.close(new Error("HTTP 403: Bearer secret-token"))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(events).toContainEqual({ authFailed: "HTTP 403" })
    expect(connect.connections).toHaveLength(1)
  })

  it("stops reconnecting after auth close errors", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.close(new Error("HTTP 401"))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(events).toEqual([{ authFailed: "HTTP 401" }])
    expect(connect.connections).toHaveLength(1)
  })

  it("uses auth close codes after generic native websocket errors", async () => {
    const listeners: Record<string, Array<(event: Event) => void>> = {}
    class FakeWebSocket extends EventTarget {
      constructor(readonly url: string, readonly init?: unknown) {
        super()
      }

      override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (typeof listener === "function") {
          listeners[type] = [...(listeners[type] ?? []), listener as (event: Event) => void]
        }
      }

      close(): void {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs())

    await source.start(realtimeHandlers(events))
    listeners.error?.forEach((listener) => listener(new Event("error")))
    listeners.close?.forEach((listener) => listener(new CloseEvent("close", { code: 4401 })))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(events).toEqual([{ authFailed: "HTTP 401" }])
  })

  it("ignores stale messages after a connection closes", async () => {
    const connect = fakeConnector()
    const updates: DriveRealtimeState[] = []
    const source = createDriveRealtimeSource(sourceArgs({
      connect,
      writeRealtimeState: async (next) => {
        updates.push(next)
      },
    }))

    await source.start(realtimeHandlers())
    const stale = connect.connections[0]
    stale?.handlers.close(new Error("network close"))
    stale?.handlers.message(JSON.stringify({ type: "library_changed", cursor: "stale" }))
    await flushPromises()

    expect(updates).toEqual([])
  })

  it("schedules only one reconnect for duplicate close events", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const source = createDriveRealtimeSource(sourceArgs({ connect }))

    await source.start(realtimeHandlers(events))
    connect.connections[0]?.handlers.close(new Error("network close"))
    connect.connections[0]?.handlers.close(new Error("network close"))
    await vi.advanceTimersByTimeAsync(1000)

    expect(events).toEqual([{ reconnect: 1000, error: "network error" }])
    expect(connect.connections).toHaveLength(2)
  })

  it("resolves headers from a provider on every connection attempt", async () => {
    const connect = fakeConnector()
    let token = 0
    const headers = vi.fn(async () => ({ authorization: `Bearer token-${++token}` }))
    const source = createDriveRealtimeSource(sourceArgs({ connect, headers }))

    await source.start(realtimeHandlers())
    await flushPromises()

    expect(connect.connections[0]?.init?.headers).toEqual({ authorization: "Bearer token-1" })
    expect(connect.connections[0]?.url.toString()).not.toContain("token-1")

    connect.connections[0]?.handlers.close(new Error("network close"))
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(connect.connections).toHaveLength(2)
    expect(connect.connections[1]?.init?.headers).toEqual({ authorization: "Bearer token-2" })
  })

  it("stops reconnecting when the headers provider fails auth", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    const headers = vi.fn(async () => {
      throw Object.assign(new Error("wspc credentials expired; re-authenticate via `wspc login`"), {
        code: "WSPC_AUTH_EXPIRED",
      })
    })
    const source = createDriveRealtimeSource(sourceArgs({ connect, headers }))

    await source.start(realtimeHandlers(events))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(events).toEqual([{ authFailed: "auth failed" }])
    expect(connect.connections).toHaveLength(0)
  })

  it("retries with backoff when the headers provider hits a network error", async () => {
    const connect = fakeConnector()
    const events: unknown[] = []
    let calls = 0
    const headers = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError("fetch failed")
      return { authorization: "Bearer token-2" }
    })
    const source = createDriveRealtimeSource(sourceArgs({ connect, headers }))

    await source.start(realtimeHandlers(events))
    await flushPromises()

    expect(events).toContainEqual({ reconnect: 1000, error: "network error" })
    expect(connect.connections).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(connect.connections).toHaveLength(1)
    expect(connect.connections[0]?.init?.headers).toEqual({ authorization: "Bearer token-2" })
  })
})

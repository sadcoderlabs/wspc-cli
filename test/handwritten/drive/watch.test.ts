import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  runDriveWatch,
  type DriveRealtimeSource,
  type DriveWatchSource,
} from "../../../src/handwritten/commands/drive/watch.js"

const readState = async () => ({ library_id: "lib_1" }) as any

function syncSummary(overrides: Partial<{ conflicts: number; errors: number }> = {}) {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    unchanged: 0,
    merged: 0,
    conflicts: 0,
    errors: 0,
    conflict_paths: [],
    paths: [],
    ...overrides,
  }
}

function fakeSource(): DriveWatchSource & {
  close: ReturnType<typeof vi.fn>
  emit(path: string): void
  waitForSubscription(): Promise<void>
} {
  let handler: ((path: string) => void) | undefined
  let resolveSubscription!: () => void
  const subscribed = new Promise<void>((resolve) => {
    resolveSubscription = resolve
  })
  return {
    onChange(next) {
      handler = next
      resolveSubscription()
    },
    close: vi.fn(async () => {}),
    emit(path: string) {
      handler?.(path)
    },
    waitForSubscription() {
      return subscribed
    },
  }
}

type RealtimeEvent = { debounce_ms?: number; immediate?: boolean; cursor?: string; path?: string; reason?: string }

function fakeRealtimeSource(): DriveRealtimeSource & {
  start: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  emitConnected(): void
  emitEvent(event: RealtimeEvent): void
  emitReconnect(delayMs: number, error: string): void
  emitAuthFailed(error?: string): void
} {
  let handlers: Parameters<DriveRealtimeSource["start"]>[0] | undefined
  return {
    start: vi.fn(async (nextHandlers) => {
      handlers = nextHandlers
    }),
    close: vi.fn(async () => {}),
    emitConnected() {
      handlers?.onConnected()
    },
    emitEvent(event) {
      handlers?.onEvent(event)
    },
    emitReconnect(delayMs, error) {
      handlers?.onReconnect(delayMs, error)
    },
    emitAuthFailed(error) {
      handlers?.onAuthFailed(error)
    },
  }
}

describe("drive watch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs one sync on startup", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())

    await runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledWith("/tmp/root")
  })

  it("does not start watching when state validation fails", async () => {
    const source: DriveWatchSource = {
      onChange: vi.fn(),
      close: vi.fn(async () => {}),
    }
    const readState = vi.fn(async () => {
      throw new Error("unsupported .wspc-drive/state.json schema")
    })
    const runSync = vi.fn(async () => syncSummary())

    await expect(runDriveWatch("/tmp/root", { source, runSync, readState, once: true })).rejects.toThrow(
      "unsupported .wspc-drive/state.json schema",
    )

    expect(source.onChange).not.toHaveBeenCalled()
    expect(source.close).not.toHaveBeenCalled()
    expect(runSync).not.toHaveBeenCalled()
  })

  it("closes the source when initial sync fails fatally", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const fatalError = Object.assign(new Error("HTTP 401: login required"), { code: "WSPC_AUTH_EXPIRED" })
    const runSync = vi.fn(async () => {
      throw fatalError
    })

    await expect(runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })).rejects.toThrow("login required")

    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("does not start realtime source in once mode", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())

    await runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent, once: true })

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(realtimeSource.start).not.toHaveBeenCalled()
    expect(realtimeSource.close).not.toHaveBeenCalled()
  })

  it("stops retry backoff when realtime startup fails", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const startError = new Error("realtime startup failed")
    realtimeSource.start.mockRejectedValueOnce(startError)
    const onEvent = vi.fn()
    const runSync = vi.fn().mockRejectedValue(new Error("HTTP 500: temporary failure"))

    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    const rejected = expect(watching).rejects.toThrow("realtime startup failed")
    await Promise.resolve()

    await rejected
    await vi.advanceTimersByTimeAsync(60_000)

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(source.close).toHaveBeenCalledTimes(1)
    expect(realtimeSource.close).toHaveBeenCalledTimes(1)
  })

  it("debounces multiple file events into one sync", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("a.txt")
    source.emit("b.txt")
    await vi.advanceTimersByTimeAsync(499)
    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(runSync).toHaveBeenCalledTimes(2)
    process.emit("SIGINT")
    await watching
  })

  it("removes the counterpart signal listener on shutdown", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const sigintBefore = process.listenerCount("SIGINT")
    const sigtermBefore = process.listenerCount("SIGTERM")
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1)
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1)
    process.emit("SIGINT")
    await watching

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(process.listenerCount("SIGINT")).toBeLessThanOrEqual(sigintBefore)
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore)
  })

  it("clears pending debounce timers when shutting down", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("a.txt")
    await vi.advanceTimersByTimeAsync(499)
    process.emit("SIGTERM")
    await watching
    await vi.advanceTimersByTimeAsync(1)

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it("rejects and closes the source when an event-triggered sync fails fatally", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const fatalError = Object.assign(new Error("HTTP 401: login required"), { code: "WSPC_AUTH_EXPIRED" })
    const runSync = vi
      .fn()
      .mockResolvedValueOnce(syncSummary())
      .mockRejectedValueOnce(fatalError)
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()
    const rejected = expect(watching).rejects.toThrow("login required")

    source.emit("a.txt")
    await vi.advanceTimersByTimeAsync(500)

    await rejected
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("cancels transient retry backoff on shutdown", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi
      .fn()
      .mockResolvedValueOnce(syncSummary())
      .mockRejectedValueOnce(new Error("HTTP 500: temporary failure"))
      .mockResolvedValueOnce(syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("a.txt")
    await vi.advanceTimersByTimeAsync(500)
    expect(runSync).toHaveBeenCalledTimes(2)

    process.emit("SIGTERM")
    await watching
    expect(source.close).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(runSync).toHaveBeenCalledTimes(2)
  })

  it("does not let file events skip transient retry backoff", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi
      .fn()
      .mockResolvedValueOnce(syncSummary())
      .mockRejectedValueOnce(new Error("HTTP 500: temporary failure"))
      .mockResolvedValueOnce(syncSummary())
      .mockResolvedValueOnce(syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("a.txt")
    await vi.advanceTimersByTimeAsync(500)
    expect(runSync).toHaveBeenCalledTimes(2)

    source.emit("b.txt")
    await vi.advanceTimersByTimeAsync(999)
    expect(runSync).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(runSync).toHaveBeenCalledTimes(3)

    process.emit("SIGINT")
    await watching
  })

  it("stops on non-retryable sync errors", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => {
      throw new Error("invalid local state")
    })

    await expect(runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })).rejects.toThrow(
      "invalid local state",
    )

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "drive_watch_retry" }))
  })

  it("runs one trailing sync after events during an active sync", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    let releaseFirstSync!: () => void
    const firstSync = new Promise((resolve) => {
      releaseFirstSync = () => resolve(syncSummary())
    })
    const runSync = vi.fn().mockImplementationOnce(() => firstSync).mockResolvedValue(syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })
    await source.waitForSubscription()

    expect(runSync).toHaveBeenCalledTimes(1)
    source.emit("a.txt")
    await vi.advanceTimersByTimeAsync(500)
    expect(runSync).toHaveBeenCalledTimes(1)

    releaseFirstSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(runSync).toHaveBeenCalledTimes(2)

    await watching
  })

  it("ignores internal drive state events", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("/tmp/root/.wspc-drive/state.json")
    await vi.advanceTimersByTimeAsync(500)

    expect(runSync).toHaveBeenCalledTimes(1)
    process.emit("SIGTERM")
    await watching
  })

  it("backs off and retries transient errors until a sync succeeds", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn().mockRejectedValueOnce(new Error("HTTP 500: boom")).mockResolvedValueOnce(syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })
    await source.waitForSubscription()
    await Promise.resolve()

    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await watching

    expect(runSync).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenCalledWith({ kind: "drive_watch_retry", delay_ms: 1000, error: "HTTP 500: boom" })
  })

  it("keeps watching after conflict summaries", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn().mockResolvedValueOnce(syncSummary({ conflicts: 1 })).mockResolvedValueOnce(syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    expect(runSync).toHaveBeenCalledTimes(1)
    source.emit("fixed.txt")
    await vi.advanceTimersByTimeAsync(500)

    expect(runSync).toHaveBeenCalledTimes(2)
    process.emit("SIGINT")
    await watching
  })

  it("debounces remote realtime events through the same sync queue", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      realtimeSource.emitEvent({ cursor: "c1", path: "notes.md", reason: "library_changed" })
      await vi.advanceTimersByTimeAsync(1999)
      expect(runSync).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      expect(runSync).toHaveBeenCalledTimes(2)
      expect(onEvent).toHaveBeenCalledWith({
        kind: "drive_realtime_event",
        message: "remote update received; syncing",
        path: "notes.md",
        reason: "library_changed",
        cursor: "c1",
      })
    } finally {
      process.emit("SIGINT")
      await watching
    }
  })

  it("coalesces local and remote events into one pending sync if local debounce fires first", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      source.emit("a.txt")
      realtimeSource.emitEvent({ cursor: "c1" })
      await vi.advanceTimersByTimeAsync(500)
      expect(runSync).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1500)
      expect(runSync).toHaveBeenCalledTimes(2)
    } finally {
      process.emit("SIGINT")
      await watching
    }
  })

  it("runs immediate remote realtime events without waiting for remote debounce", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      realtimeSource.emitEvent({ immediate: true, reason: "resync_required" })
      await Promise.resolve()

      expect(runSync).toHaveBeenCalledTimes(2)
    } finally {
      process.emit("SIGINT")
      await watching
    }
  })

  it("keeps local watch running after realtime auth failure", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      realtimeSource.emitAuthFailed()
      expect(onEvent).toHaveBeenCalledWith({ kind: "drive_realtime_auth_failed", error: "auth failed" })

      source.emit("after-auth.txt")
      await vi.advanceTimersByTimeAsync(500)
      expect(runSync).toHaveBeenCalledTimes(2)
    } finally {
      process.emit("SIGINT")
      await watching
    }
  })

  it("emits realtime connection status events", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      realtimeSource.emitConnected()
      realtimeSource.emitReconnect(1000, "network failed")

      expect(onEvent).toHaveBeenCalledWith({ kind: "drive_realtime_connected", library_id: "lib_1" })
      expect(onEvent).toHaveBeenCalledWith({
        kind: "drive_realtime_reconnecting",
        delay_ms: 1000,
        error: "network failed",
      })
    } finally {
      process.emit("SIGINT")
      await watching
    }
  })

  it("closes realtime source on shutdown", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    process.emit("SIGTERM")
    await watching

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(realtimeSource.close).toHaveBeenCalledTimes(1)
  })
})

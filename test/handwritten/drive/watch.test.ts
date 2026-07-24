import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createChokidarSource,
  createNativeRecursiveSource,
  runDriveWatch,
  type DriveRealtimeSource,
  type DriveWatchTimer,
  type DriveWatchSource,
} from "../../../src/handwritten/commands/drive/watch.js"
import { DriveHttpError, DriveRetryableSyncError } from "../../../src/handwritten/commands/drive/retry.js"
import type { DriveSyncSummary } from "../../../src/handwritten/commands/drive/sync.js"

const readState = async () => ({ library_id: "lib_1" }) as any

function syncSummary(overrides: Partial<DriveSyncSummary> = {}): DriveSyncSummary {
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
  emit(path?: string): void
  waitForSubscription(): Promise<void>
} {
  let handler: ((path?: string) => void) | undefined
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
    emit(path?: string) {
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
  emitWarning(warning: string): void
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
    emitWarning(warning) {
      handlers?.onWarning?.(warning)
    },
  }
}

function manualTimer(): DriveWatchTimer & { pending: Array<{ delayMs: number; fire(): void; cancelled: boolean }> } {
  const pending: Array<{ delayMs: number; fire(): void; cancelled: boolean }> = []
  return {
    pending,
    now: () => new Date("2026-07-23T00:00:00.000Z"),
    schedule(delayMs, callback) {
      const scheduled = {
        delayMs,
        cancelled: false,
        fire() {
          if (!scheduled.cancelled) callback()
        },
      }
      pending.push(scheduled)
      return { cancel: () => { scheduled.cancelled = true } }
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe("drive watch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("emits single-line NDJSON events in json output mode", async () => {
    const source = fakeSource()
    const runSync = vi.fn(async () =>
      syncSummary({} as never) as ReturnType<typeof syncSummary> & { paths: unknown[] },
    )
    const writes: string[] = []
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as never)
    vi.stubEnv("WSPC_OUTPUT", "json")

    try {
      await runDriveWatch("/tmp/root", { source, runSync, readState, once: true })
    } finally {
      writeSpy.mockRestore()
      vi.unstubAllEnvs()
    }

    expect(writes.length).toBeGreaterThan(0)
    for (const chunk of writes) {
      expect(chunk.endsWith("\n")).toBe(true)
      const line = chunk.slice(0, -1)
      expect(line).not.toContain("\n")
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it("runs one sync on startup", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())

    await runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledWith("/tmp/root", expect.any(Function), undefined)
  })

  it("emits drive_sync_progress events from the sync progress callback", async () => {
    const source = fakeSource()
    const events: Array<{ kind?: string; processed?: number; total?: number }> = []
    const runSync = vi.fn(async (_root: string, onProgress?: (processed: number, total: number) => void) => {
      onProgress?.(0, 2)
      onProgress?.(1, 2)
      onProgress?.(2, 2)
      return syncSummary()
    })

    await runDriveWatch("/tmp/root", {
      source,
      runSync,
      readState,
      onEvent: (event) => events.push(event as { kind?: string; processed?: number; total?: number }),
      once: true,
    })

    const progressEvents = events.filter((event) => event.kind === "drive_sync_progress")
    expect(progressEvents).toEqual([
      { kind: "drive_sync_progress", processed: 0, total: 2 },
      { kind: "drive_sync_progress", processed: 1, total: 2 },
      { kind: "drive_sync_progress", processed: 2, total: 2 },
    ])
  })

  it("emits drive_sync_start before each sync round", async () => {
    const source = fakeSource()
    const events: Array<{ kind?: string }> = []
    const runSync = vi.fn(async () => syncSummary())

    await runDriveWatch("/tmp/root", { source, runSync, readState, onEvent: (event) => events.push(event as { kind?: string }), once: true })

    const kinds = events.map((event) => event.kind)
    expect(kinds.indexOf("drive_sync_start")).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf("drive_sync_start")).toBeLessThan(kinds.indexOf("drive_sync_once"))
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

    await expect(runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })).rejects.toThrow("login required")

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
    await flushMicrotasks()

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
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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

  it("passes accumulated dirty paths to local-triggered syncs only", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const dirtyByCall: Array<string[] | undefined> = []
    const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
      dirtyByCall.push(dirtyPaths)
      return syncSummary()
    })
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("/tmp/root/notes/a.txt")
    source.emit("/tmp/root/b.txt")
    await vi.advanceTimersByTimeAsync(600)

    expect(dirtyByCall[0]).toBeUndefined()
    expect(dirtyByCall[1]?.sort()).toEqual(["b.txt", "notes/a.txt"])
    process.emit("SIGINT")
    await watching
  })

  it("runs a full reconciliation for an unknown local path", async () => {
    const source = fakeSource()
    const dirtyByCall: Array<string[] | undefined> = []
    const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
      dirtyByCall.push(dirtyPaths)
      return syncSummary()
    })
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent: vi.fn(),
    })
    await source.waitForSubscription()
    await flushMicrotasks()

    source.emit()
    await vi.advanceTimersByTimeAsync(500)

    expect(dirtyByCall).toEqual([undefined, undefined])
    process.emit("SIGINT")
    await watching
  })

  it.each(["local-first", "unknown-first"] as const)(
    "keeps coalesced concrete and unknown local events as a full reconciliation (%s)",
    async (order) => {
      const source = fakeSource()
      const dirtyByCall: Array<string[] | undefined> = []
      const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
        dirtyByCall.push(dirtyPaths)
        return syncSummary()
      })
      const watching = runDriveWatch("/tmp/root", {
        source,
        realtimeSource: fakeRealtimeSource(),
        runSync,
        readState,
        onEvent: vi.fn(),
      })
      await source.waitForSubscription()
      await flushMicrotasks()

      if (order === "local-first") {
        source.emit("/tmp/root/a.txt")
        source.emit()
      } else {
        source.emit()
        source.emit("/tmp/root/a.txt")
      }
      await vi.advanceTimersByTimeAsync(500)

      expect(dirtyByCall).toEqual([undefined, undefined])
      process.emit("SIGINT")
      await watching
    },
  )

  it("ignores fs events for internal sync temp artifacts", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit(".notes.md.wspc-download-abc.tmp")
    source.emit("sub/.readme.md.wspc-backup-def.tmp")
    source.emit(".readme.md.wspc-merge-xyz.tmp")
    await vi.advanceTimersByTimeAsync(600)

    // Only the initial sync ran; temp artifacts never schedule another.
    expect(runSync).toHaveBeenCalledTimes(1)
    process.emit("SIGINT")
    await watching
  })

  it("removes the counterpart signal listener on shutdown", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const sigintBefore = process.listenerCount("SIGINT")
    const sigtermBefore = process.listenerCount("SIGTERM")
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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
    const dirtyByCall: Array<string[] | undefined> = []
    const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
      dirtyByCall.push(dirtyPaths)
      if (dirtyByCall.length === 2) throw new Error("HTTP 500: temporary failure")
      return syncSummary()
    })
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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
    expect(dirtyByCall[2]).toBeUndefined()

    process.emit("SIGINT")
    await watching
  })

  it("stops on non-retryable sync errors", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => {
      throw new Error("invalid local state")
    })

    await expect(runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })).rejects.toThrow(
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

  it("runs one trailing full reconciliation for an unknown path during an active sync", async () => {
    const source = fakeSource()
    const dirtyByCall: Array<string[] | undefined> = []
    let releaseFirstSync!: () => void
    const firstSync = new Promise<DriveSyncSummary>((resolve) => {
      releaseFirstSync = () => resolve(syncSummary())
    })
    const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
      dirtyByCall.push(dirtyPaths)
      if (dirtyByCall.length === 1) return firstSync
      return syncSummary()
    })
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent: vi.fn(), once: true })
    await source.waitForSubscription()

    source.emit()
    await vi.advanceTimersByTimeAsync(500)
    expect(runSync).toHaveBeenCalledTimes(1)

    releaseFirstSync()
    await flushMicrotasks()

    expect(dirtyByCall).toEqual([undefined, undefined])
    await watching
  })

  it("ignores internal drive state events", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    source.emit("/tmp/root/.wspc-drive/state.json")
    await vi.advanceTimersByTimeAsync(500)

    expect(runSync).toHaveBeenCalledTimes(1)
    process.emit("SIGTERM")
    await watching
  })

  it.each(["ignore-first", "local-first"] as const)(
    "keeps coalesced ignore and local events as a full reconciliation (%s)",
    async (order) => {
      const source = fakeSource()
      const dirtyByCall: Array<string[] | undefined> = []
      const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
        dirtyByCall.push(dirtyPaths)
        return syncSummary()
      })
      const watching = runDriveWatch("/tmp/root", {
        source,
        realtimeSource: fakeRealtimeSource(),
        runSync,
        readState,
        onEvent: vi.fn(),
      })
      await source.waitForSubscription()
      await flushMicrotasks()

      if (order === "ignore-first") {
        source.emit("/tmp/root/.wspc-drive/ignore")
        source.emit("/tmp/root/notes.md")
      } else {
        source.emit("/tmp/root/notes.md")
        source.emit("/tmp/root/.wspc-drive/ignore")
      }
      await vi.advanceTimersByTimeAsync(500)

      expect(dirtyByCall).toEqual([undefined, undefined])
      process.emit("SIGTERM")
      await watching
    },
  )

  it("keeps a trailing reconciliation full when local activity follows an ignore event during sync", async () => {
    const source = fakeSource()
    const dirtyByCall: Array<string[] | undefined> = []
    let releaseFirstSync!: () => void
    const firstSync = new Promise<DriveSyncSummary>((resolve) => {
      releaseFirstSync = () => resolve(syncSummary())
    })
    const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
      dirtyByCall.push(dirtyPaths)
      if (dirtyByCall.length === 1) return firstSync
      return syncSummary()
    })
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent: vi.fn(), once: true })
    await source.waitForSubscription()

    source.emit("/tmp/root/.wspc-drive/ignore")
    source.emit("/tmp/root/notes.md")
    await vi.advanceTimersByTimeAsync(500)
    releaseFirstSync()
    await flushMicrotasks()

    expect(dirtyByCall).toEqual([undefined, undefined])
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
    expect(onEvent).toHaveBeenCalledWith({
      kind: "drive_watch_retry",
      reason: "transient",
      delay_ms: 1000,
      error: "HTTP 500: boom",
    })
  })

  it("honors Retry-After, emits structured recovery context, and retries with a full scan", async () => {
    const source = fakeSource()
    const timer = manualTimer()
    const onEvent = vi.fn()
    const pathErrors = [
      {
        path: "bad\nname.md",
        code: "INVALID_DRIVE_PATH",
        message: "invalid drive path: control character",
        retryable: false,
      },
    ]
    const runSync = vi
      .fn()
      .mockRejectedValueOnce(
        new DriveRetryableSyncError(new DriveHttpError(429, { retryAfterMs: 120_000 }), {
          remaining: 481,
          pathErrors,
        }),
      )
      .mockResolvedValueOnce(syncSummary({ errors: 1, path_errors: pathErrors }))

    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true, timer })
    await source.waitForSubscription()
    await flushMicrotasks()

    expect(timer.pending[0]?.delayMs).toBe(120_000)
    expect(onEvent).toHaveBeenCalledWith({
      kind: "drive_watch_retry",
      reason: "rate_limited",
      delay_ms: 120_000,
      remaining: 481,
      error: "HTTP 429",
      path_errors: pathErrors,
    })
    timer.pending[0]?.fire()
    await watching

    expect(runSync).toHaveBeenNthCalledWith(2, "/tmp/root", expect.any(Function), undefined)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "drive_sync_once",
      errors: 1,
      path_errors: pathErrors,
    }))
  })

  it("retries without an attempt cap and applies exponential fallback delays", async () => {
    const source = fakeSource()
    const timer = manualTimer()
    const onEvent = vi.fn()
    const runSync = vi
      .fn()
      .mockRejectedValueOnce(new DriveHttpError(503))
      .mockRejectedValueOnce(new DriveHttpError(503))
      .mockRejectedValueOnce(new DriveHttpError(503))
      .mockRejectedValueOnce(new DriveHttpError(503))
      .mockResolvedValueOnce(syncSummary())

    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true, timer })
    await source.waitForSubscription()
    for (const expectedDelay of [1_000, 2_000, 4_000, 8_000]) {
      await flushMicrotasks()
      const scheduled = timer.pending.at(-1)
      expect(scheduled?.delayMs).toBe(expectedDelay)
      scheduled?.fire()
    }
    await watching

    expect(runSync).toHaveBeenCalledTimes(5)
    expect(onEvent.mock.calls
      .map(([event]) => event as { kind?: string; delay_ms?: number })
      .filter((event) => event.kind === "drive_watch_retry")
      .map((event) => event.delay_ms)).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it("resets the fallback delay after a successful sync round", async () => {
    const source = fakeSource()
    const timer = manualTimer()
    const runSync = vi
      .fn()
      .mockRejectedValueOnce(new DriveHttpError(503))
      .mockResolvedValueOnce(syncSummary())
      .mockRejectedValueOnce(new DriveHttpError(503))
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent: vi.fn(),
      timer,
    })
    await source.waitForSubscription()
    await flushMicrotasks()
    expect(timer.pending.at(-1)?.delayMs).toBe(1_000)

    timer.pending.at(-1)?.fire()
    await flushMicrotasks()
    source.emit("/tmp/root/again.txt")
    expect(timer.pending.at(-1)?.delayMs).toBe(500)
    timer.pending.at(-1)?.fire()
    await flushMicrotasks()

    expect(timer.pending.at(-1)?.delayMs).toBe(1_000)
    process.emit("SIGINT")
    await watching
  })

  it("keeps watching after conflict summaries", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn().mockResolvedValueOnce(syncSummary({ conflicts: 1 })).mockResolvedValueOnce(syncSummary())
    const watching = runDriveWatch("/tmp/root", {
      source,
      realtimeSource: fakeRealtimeSource(),
      runSync,
      readState,
      onEvent,
    })
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

  it.each(["local-first", "remote-first"] as const)(
    "keeps coalesced local and remote events as a full reconciliation (%s)",
    async (order) => {
      const source = fakeSource()
      const realtimeSource = fakeRealtimeSource()
      const dirtyByCall: Array<string[] | undefined> = []
      const runSync = vi.fn(async (_root: string, _onProgress?: unknown, dirtyPaths?: string[]) => {
        dirtyByCall.push(dirtyPaths)
        return syncSummary()
      })
      const watching = runDriveWatch("/tmp/root", {
        source,
        realtimeSource,
        runSync,
        readState,
        onEvent: vi.fn(),
      })
      await source.waitForSubscription()
      await flushMicrotasks()

      try {
        if (order === "local-first") {
          source.emit("/tmp/root/a.txt")
          realtimeSource.emitEvent({ cursor: "c1" })
        } else {
          realtimeSource.emitEvent({ cursor: "c1" })
          source.emit("/tmp/root/a.txt")
        }
        await vi.advanceTimersByTimeAsync(500)

        expect(dirtyByCall).toEqual([undefined, undefined])
      } finally {
        process.emit("SIGINT")
        await watching
      }
    },
  )

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

  it("emits realtime warning events", async () => {
    const source = fakeSource()
    const realtimeSource = fakeRealtimeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => syncSummary())
    const watching = runDriveWatch("/tmp/root", { source, realtimeSource, runSync, readState, onEvent })
    await source.waitForSubscription()
    await Promise.resolve()
    await Promise.resolve()

    try {
      realtimeSource.emitWarning("unknown realtime message")

      expect(onEvent).toHaveBeenCalledWith({
        kind: "drive_realtime_warning",
        warning: "unknown realtime message",
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

describe("createDefaultWatchSource", () => {
  it("forwards ignore-file add, change, and unlink events while suppressing other internal paths", async () => {
    let onAll!: (event: string, path: string) => void
    let ignored!: (path: string) => boolean
    const watcher = {
      on: vi.fn((event: string, handler: (event: string, path: string) => void) => {
        if (event === "all") onAll = handler
        return watcher
      }),
      close: vi.fn(async () => {}),
    }
    const watch = vi.fn((_root, options) => {
      ignored = options.ignored
      return watcher
    })
    const source = createChokidarSource("/tmp/root", watch as never)
    const onChange = vi.fn()
    source.onChange(onChange)

    expect(ignored("/tmp/root/.wspc-drive")).toBe(false)
    expect(ignored("/tmp/root/.wspc-drive/ignore")).toBe(false)
    expect(ignored("/tmp/root/.wspc-drive/state.json")).toBe(true)
    for (const event of ["add", "change", "unlink"]) {
      onAll(event, "/tmp/root/.wspc-drive/ignore")
    }

    expect(onChange).toHaveBeenCalledTimes(3)
    expect(onChange).toHaveBeenCalledWith("/tmp/root/.wspc-drive/ignore")
    await source.close()
  })

  it("emits an unknown-path change when native fs.watch omits the filename", async () => {
    let callback!: (event: string, filename: string | Buffer | null) => void
    const watcher = {
      on: vi.fn(),
      close: vi.fn(),
    }
    const watch = vi.fn((_root, _options, next) => {
      callback = next
      return watcher
    })
    const source = createNativeRecursiveSource("/tmp/root", watch as never)
    const onChange = vi.fn()
    source.onChange(onChange)

    callback("change", null)

    expect(onChange).toHaveBeenCalledWith(undefined)
    await source.close()
  })

  it("does not block renaming a watched subdirectory", async () => {
    const { mkdir, mkdtemp, rename, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { createDefaultWatchSource } = await import("../../../src/handwritten/commands/drive/watch.js")

    const root = await mkdtemp(join(tmpdir(), "wspc-drive-watch-"))
    const inner = join(root, "sub", "inner")
    await mkdir(inner, { recursive: true })
    await writeFile(join(inner, "a.txt"), "a")

    const source = createDefaultWatchSource(root)
    try {
      let sawInnerEvent!: () => void
      const innerEventSeen = new Promise<void>((resolve) => {
        sawInnerEvent = resolve
      })
      source.onChange((path) => {
        if (path?.includes("probe")) sawInnerEvent()
      })

      // Keep writing probes until one is observed: proves the watcher covers
      // the deepest directory before we attempt the rename.
      let probeCount = 0
      let pendingProbe: Promise<void> = Promise.resolve()
      const probeTimer = setInterval(() => {
        pendingProbe = writeFile(join(inner, `probe-${probeCount++}.txt`), "p").catch(() => {})
      }, 100)
      try {
        await innerEventSeen
      } finally {
        clearInterval(probeTimer)
      }
      // The last probe write must release its handle before the rename, or
      // the open file itself blocks the rename on Windows.
      await pendingProbe

      await expect(rename(join(root, "sub"), join(root, "sub-renamed"))).resolves.toBeUndefined()
    } finally {
      await source.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runDriveWatch, type DriveWatchSource } from "../../../src/handwritten/commands/drive/watch.js"

const readState = async () => ({ library_id: "lib_1" }) as any

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
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))

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
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))

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

  it("debounces multiple file events into one sync", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent })
    await source.waitForSubscription()

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
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
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
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore)
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore)
  })

  it("clears pending debounce timers when shutting down", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
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
      .mockResolvedValueOnce({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] })
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
})

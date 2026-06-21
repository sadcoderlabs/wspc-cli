import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runDriveWatch, type DriveWatchSource } from "../../../src/handwritten/commands/drive/watch.js"

const readState = async () => ({ library_id: "lib_1" }) as any

function fakeSource(): DriveWatchSource & { emit(path: string): void; waitForSubscription(): Promise<void> } {
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
    async close() {},
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

  it("debounces multiple file events into one sync", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })
    await source.waitForSubscription()

    source.emit("a.txt")
    source.emit("b.txt")
    await vi.advanceTimersByTimeAsync(499)
    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await watching

    expect(runSync).toHaveBeenCalledTimes(2)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

  it("debounces multiple file events into one sync", async () => {
    const source = fakeSource()
    const onEvent = vi.fn()
    const runSync = vi.fn(async () => ({ uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }))
    const watching = runDriveWatch("/tmp/root", { source, runSync, readState, onEvent, once: true })

    source.emit("a.txt")
    source.emit("b.txt")
    await vi.advanceTimersByTimeAsync(499)
    expect(runSync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await watching

    expect(runSync).toHaveBeenCalledTimes(2)
  })
})

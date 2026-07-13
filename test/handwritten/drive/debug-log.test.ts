import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { DateTime } from "luxon"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDriveDebugLogger } from "../../../src/handwritten/commands/drive/debug-log.js"
import { runDriveWatch, type DriveWatchSource } from "../../../src/handwritten/commands/drive/watch.js"
import { runDriveSyncOnce, type DriveSyncApi } from "../../../src/handwritten/commands/drive/sync.js"
import { initDriveState } from "../../../src/handwritten/commands/drive/state.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-07-13T10:00:00+08:00", { setZone: true }),
}

async function readDebugLines(root: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(root, ".wspc-drive", "debug.log"), "utf8")
  return raw
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("drive debug logger", () => {
  it("appends NDJSON lines with ts and event fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-debug-log-"))
    const logger = createDriveDebugLogger(root, { clock: fixedClock })

    logger.log("fs_event", { path: "notes.txt" })
    logger.log("retry", { delay_ms: 1000, error: "network" })

    const lines = await readDebugLines(root)
    expect(lines).toEqual([
      { ts: "2026-07-13T10:00:00.000+08:00", event: "fs_event", path: "notes.txt" },
      { ts: "2026-07-13T10:00:00.000+08:00", event: "retry", delay_ms: 1000, error: "network" },
    ])
  })

  it("rotates debug.log to debug.log.old past the size threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-debug-rotate-"))
    const logger = createDriveDebugLogger(root, { clock: fixedClock, maxBytes: 10 })

    logger.log("fs_event", { path: "a".repeat(50) })
    logger.log("fs_event", { path: "second" })

    const oldStat = await stat(join(root, ".wspc-drive", "debug.log.old"))
    expect(oldStat.size).toBeGreaterThan(10)
    const lines = await readDebugLines(root)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ event: "fs_event", path: "second" })
  })

  it("swallows write failures without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-debug-fail-"))
    // Make <root>/.wspc-drive a file so mkdir/append must fail.
    await writeFile(join(root, ".wspc-drive"), "not a dir")
    const logger = createDriveDebugLogger(root, { clock: fixedClock })

    expect(() => logger.log("fs_event", { path: "x" })).not.toThrow()
  })
})

function syncSummary() {
  return {
    uploaded: 1,
    downloaded: 0,
    deleted: 0,
    unchanged: 0,
    merged: 0,
    conflicts: 0,
    errors: 0,
    conflict_paths: [],
    paths: [],
  }
}

function fakeSource(): DriveWatchSource & { emit(path: string): void } {
  const handlers: Array<(path: string) => void> = []
  return {
    onChange(handler) {
      handlers.push(handler)
    },
    async close() {},
    emit(path: string) {
      for (const handler of handlers) handler(path)
    },
  }
}

describe("drive watch --debug", () => {
  it("logs fs_event, sync_start, and sync_end", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-watch-debug-"))
    const source = fakeSource()
    const runSync = vi.fn(async () => {
      // Emit only once: emitting on every call would schedule a rerun after
      // each sync and the watch loop would never drain.
      if (runSync.mock.calls.length === 1) source.emit(join(root, "notes.txt"))
      return syncSummary()
    })
    const readState = async () => ({ library_id: "lib_1" }) as never

    await runDriveWatch(root, { source, runSync, readState, once: true, debug: true })

    const lines = await readDebugLines(root)
    const events = lines.map((line) => line.event)
    expect(events).toContain("fs_event")
    expect(events).toContain("sync_start")
    expect(events).toContain("sync_end")
    const start = lines.find((line) => line.event === "sync_start")
    expect(start).toMatchObject({ trigger: "initial" })
    const end = lines.find((line) => line.event === "sync_end")
    expect(end).toMatchObject({ uploaded: 1, conflicts: 0, errors: 0 })
    expect(typeof end?.duration_ms).toBe("number")
  })

  it("logs retry events with backoff delay", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-watch-debug-retry-"))
    let calls = 0
    const runSync = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error("network flake")
      return syncSummary()
    })
    const readState = async () => ({ library_id: "lib_1" }) as never

    // Real timers: the first backoff is only 1s.
    await runDriveWatch(root, { source: fakeSource(), runSync, readState, once: true, debug: true })
    expect(calls).toBe(2)

    const lines = await readDebugLines(root)
    const retry = lines.find((line) => line.event === "retry")
    expect(retry).toMatchObject({ delay_ms: 1000, error: "network flake" })
  })

  it("does not create debug.log when debug is off", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-watch-nodebug-"))
    const runSync = vi.fn(async () => syncSummary())
    const readState = async () => ({ library_id: "lib_1" }) as never

    await runDriveWatch(root, { source: fakeSource(), runSync, readState, once: true })

    await expect(stat(join(root, ".wspc-drive", "debug.log"))).rejects.toThrow()
  })
})

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

type ManifestEntry = {
  id: string
  path: string
  kind: "file"
  entry_version: number
  current_version_id?: string
  content_sha256?: string
  size_bytes: number
  updated_at: string
}

function remoteEntry(path: string, content: string, version = 1): ManifestEntry {
  return {
    id: `ent_${path.replace(/[^a-z0-9]/gi, "_")}_${version}`,
    path,
    kind: "file",
    entry_version: version,
    current_version_id: `ver_${version}`,
    content_sha256: sha256(content),
    size_bytes: Buffer.byteLength(content),
    updated_at: "2026-07-13T00:00:00.000Z",
  }
}

function mkApi(entries: ManifestEntry[], downloads: Record<string, string> = {}): DriveSyncApi {
  return {
    async getManifest() {
      return {
        library: {
          id: "lib_1",
          org_id: "org_1",
          name: "Docs",
          version: 1,
          file_count: entries.length,
          storage_bytes: 0,
          created_by_user_id: "usr_1",
          created_at: 1,
          updated_at: 2,
        },
        entries,
        next_cursor: null,
      } as never
    },
    async uploadFile(_id, path, body, digest, expectedEntryVersion) {
      const content = typeof body === "string" ? body : Buffer.from(await new Response(body).arrayBuffer()).toString("utf8")
      return {
        entry: remoteEntry(path, content, (expectedEntryVersion ?? 0) + 1),
        result: expectedEntryVersion === 0 ? "created" : "updated",
      } as never
    },
    async downloadFile(_id, path, versionId) {
      const key = versionId === undefined ? path : `${path}@${versionId}`
      const content = downloads[key]
      if (content === undefined) throw new Error(`missing test download: ${key}`)
      return new Response(content)
    },
    async deleteFile() {
      throw new Error("unexpected delete")
    },
  }
}

describe("drive sync debug events", () => {
  it("logs decision, conflict, and sync_phases events", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-debug-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "new.txt"), "hello")
    // create_create conflict: local and remote both exist with no base state.
    await writeFile(join(root, "clash.bin"), "local bytes")
    const remote = remoteEntry("clash.bin", "remote bytes", 1)
    const api = mkApi([remote], { "clash.bin@ver_1": "remote bytes" })
    const logger = createDriveDebugLogger(root, { clock: fixedClock })

    await runDriveSyncOnce(root, api, undefined, undefined, logger)

    const lines = await readDebugLines(root)
    const decisions = lines.filter((line) => line.event === "decision")
    expect(decisions).toContainEqual(
      expect.objectContaining({ path: "new.txt", action: "upload_create", local_sha256: sha256("hello") }),
    )
    expect(decisions).toContainEqual(
      expect.objectContaining({
        path: "clash.bin",
        action: "conflict",
        reason: "local_and_remote_without_base",
        remote_version_id: "ver_1",
      }),
    )
    // Unchanged paths must not be logged.
    expect(decisions.every((line) => line.action !== "unchanged")).toBe(true)

    const conflict = lines.find((line) => line.event === "conflict")
    expect(conflict).toMatchObject({
      path: "clash.bin",
      type: "create_create",
      strategy: "conflict_copy",
    })

    const phases = lines.find((line) => line.event === "sync_phases")
    expect(typeof phases?.scan_ms).toBe("number")
    expect(typeof phases?.manifest_ms).toBe("number")
    expect(typeof phases?.process_ms).toBe("number")
  })
})

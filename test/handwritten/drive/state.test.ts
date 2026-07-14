import { describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DateTime } from "luxon"
import {
  ensureDriveRealtimeState,
  initDriveState,
  readDriveState,
  withDriveLock,
  writeDriveState,
  writeDriveRealtimeState,
  type DriveState,
} from "../../../src/handwritten/commands/drive/state.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00.123Z", { setZone: true }),
}

describe("drive state", () => {
  it("creates and reads empty state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_123", fixedClock)
    const state = await readDriveState(root)
    expect(state.library_id).toBe("lib_123")
    expect(state.created_at).toBe("2026-06-21T10:10:00.123Z")
    expect(state.updated_at).toBe("2026-06-21T10:10:00.123Z")
    expect(state.entries).toEqual({})
    expect(state.conflicts).toEqual({})
  })

  it("refuses a different existing binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_a")
    await expect(initDriveState(root, "lib_b")).rejects.toThrow(/already bound to lib_a/)
  })

  it("ignores temp state files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "state.json.tmp-test"), "bad json")
    await expect(readDriveState(root)).resolves.toMatchObject({ library_id: "lib_a" })
  })

  it("fails when lock already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-"))
    await initDriveState(root, "lib_a")
    await withDriveLock(root, async () => {
      await expect(withDriveLock(root, async () => undefined)).rejects.toThrow(/sync lock already exists/)
    })
  })

  it("rejects a fresh existing lock file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-fresh-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "sync.lock"), "")

    await expect(withDriveLock(root, async () => undefined)).rejects.toThrow(/sync lock already exists/)
  })

  it("recovers a stale existing lock file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-stale-"))
    await initDriveState(root, "lib_a")
    const lockFile = join(root, ".wspc-drive", "sync.lock")
    await writeFile(lockFile, "")
    const staleTime = new Date(Date.now() - 11 * 60 * 1000)
    await utimes(lockFile, staleTime, staleTime)
    let ran = false

    await withDriveLock(root, async () => {
      ran = true
    })

    expect(ran).toBe(true)
  })

  it("writes the owning pid into the lock file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-pid-"))
    await initDriveState(root, "lib_a")
    const lockFile = join(root, ".wspc-drive", "sync.lock")

    await withDriveLock(root, async () => {
      expect(await readFile(lockFile, "utf8")).toBe(String(process.pid))
    })
  })

  it("recovers a fresh lock whose owning process is dead", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-deadpid-"))
    await initDriveState(root, "lib_a")
    const lockFile = join(root, ".wspc-drive", "sync.lock")
    await writeFile(lockFile, String(findDeadPid()))
    let ran = false

    await withDriveLock(root, async () => {
      ran = true
    })

    expect(ran).toBe(true)
  })

  it("rejects a fresh lock whose owning process is alive", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-livepid-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "sync.lock"), String(process.pid))

    await expect(withDriveLock(root, async () => undefined)).rejects.toThrow(/sync lock already exists/)
  })

  it("tags lock contention with a diagnostic code", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-code-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "sync.lock"), String(process.pid))

    await expect(withDriveLock(root, async () => undefined)).rejects.toMatchObject({
      code: "WSPC_DRIVE_LOCK_HELD",
    })
  })

  it("retries a held lock and acquires it once released", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-retry-"))
    await initDriveState(root, "lib_a")
    const lockFile = join(root, ".wspc-drive", "sync.lock")
    await writeFile(lockFile, String(process.pid))
    let sleeps = 0
    const sleep = async () => {
      sleeps += 1
      if (sleeps === 2) await rm(lockFile, { force: true })
    }
    let ran = false

    await withDriveLock(root, async () => {
      ran = true
    }, { retries: 5, sleep })

    expect(ran).toBe(true)
    expect(sleeps).toBe(2)
  })

  it("gives up retrying and reports contention when the lock never releases", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-retry-giveup-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "sync.lock"), String(process.pid))
    let sleeps = 0
    const sleep = async () => {
      sleeps += 1
    }

    await expect(
      withDriveLock(root, async () => undefined, { retries: 3, sleep }),
    ).rejects.toThrow(/sync lock already exists/)
    expect(sleeps).toBe(3)
  })

  it("rejects unsupported schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-"))
    const badState = { schema_version: 2, library_id: "lib_a", entries: {}, conflicts: {} }
    const path = join(root, ".wspc-drive", "state.json")
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(path, JSON.stringify(badState), { mode: 0o600 })
    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects missing timestamps", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-missing-ts-"))
    const badState = { schema_version: 1, library_id: "lib_a", entries: {}, conflicts: {} }
    const path = join(root, ".wspc-drive", "state.json")
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(path, JSON.stringify(badState), { mode: 0o600 })
    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects malformed entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-entries-"))
    const badState = {
      schema_version: 1,
      library_id: "lib_a",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      entries: { "a.txt": 42 },
      conflicts: {},
    }
    const path = join(root, ".wspc-drive", "state.json")
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(path, JSON.stringify(badState), { mode: 0o600 })
    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("accepts extended conflict metadata while preserving schema version 1", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-conflict-meta-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {
        "notes/today.md": {
          detected_at: "2026-06-21T10:10:00.000Z",
          reason: "local_and_remote_changed",
          type: "edit_edit",
          strategy: "conflict_copy",
          base_version_id: "ver_base",
          remote_version_id: "ver_remote",
          remote_entry_version: 9,
          conflict_paths: ["notes/today.remote-conflict-20260621T101000Z.ver_remo.md"],
        },
      },
    }))

    expect((await readDriveState(root)).conflicts["notes/today.md"]).toMatchObject({
      type: "edit_edit",
      strategy: "conflict_copy",
      conflict_paths: ["notes/today.remote-conflict-20260621T101000Z.ver_remo.md"],
    })
  })

  it("rejects malformed extended conflict metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-conflict-meta-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {
        "notes/today.md": {
          detected_at: "2026-06-21T10:10:00.000Z",
          reason: "local_and_remote_changed",
          type: "edit_edit",
          strategy: "conflict_copy",
          conflict_paths: ["notes/today.remote-conflict-20260621T101000Z.ver_remo.md", 42],
        },
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

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
        client_id: "drvcli_existing",
        last_cursor: "000000000000000123",
        last_connected_at: "2026-06-21T10:00:00.000Z",
        last_event_at: "2026-06-21T10:05:00.000Z",
      },
    }))

    const state = await readDriveState(root)

    expect(state.schema_version).toBe(1)
    expect(state.realtime).toEqual({
      client_id: "drvcli_existing",
      last_cursor: "000000000000000123",
      last_connected_at: "2026-06-21T10:00:00.000Z",
      last_event_at: "2026-06-21T10:05:00.000Z",
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
      realtime: {
        client_id: "host-petes-macbook",
        last_cursor: 42,
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects invalid realtime cursor type", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-realtime-cursor-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {},
      realtime: {
        client_id: "drvcli_valid",
        last_cursor: 42,
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects invalid realtime timestamps", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-realtime-time-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {},
      realtime: {
        client_id: "drvcli_valid",
        last_connected_at: "not-a-date",
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects realtime timestamps without time and offset", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-realtime-boundary-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {},
      realtime: {
        client_id: "drvcli_valid",
        last_connected_at: "2026-06-21",
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("rejects unknown realtime metadata keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-bad-realtime-extra-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {},
      realtime: {
        client_id: "drvcli_valid",
        access_token: "secret",
      },
    }))

    await expect(readDriveState(root)).rejects.toThrow(/unsupported \.wspc-drive\/state\.json schema/)
  })

  it("creates an opaque realtime client id when missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-ensure-realtime-"))
    await initDriveState(root, "lib_a")

    const state = await ensureDriveRealtimeState(root)

    expect(state.realtime?.client_id).toMatch(/^drvcli_[A-Za-z0-9_-]+$/)
    await expect(readDriveState(root)).resolves.toMatchObject({
      realtime: state.realtime,
    })
  })

  it("adds a realtime client id while preserving existing cursor metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-ensure-realtime-cursor-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
      schema_version: 1,
      library_id: "lib_1",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      entries: {},
      conflicts: {},
      realtime: {
        last_cursor: "000123",
      },
    }))

    const state = await ensureDriveRealtimeState(root)

    expect(state.realtime).toMatchObject({
      client_id: expect.stringMatching(/^drvcli_[A-Za-z0-9_-]+$/),
      last_cursor: "000123",
    })
    expect((await readDriveState(root)).realtime).toEqual(state.realtime)
  })

  it("writes realtime metadata under the drive lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-realtime-lock-"))
    await initDriveState(root, "lib_a")

    await withDriveLock(root, async () => {
      await expect(
        writeDriveRealtimeState(root, { client_id: "drvcli_abc", last_cursor: "c1" }, { retries: 2, sleep: async () => {} }),
      ).rejects.toThrow(/sync lock already exists/)
    })
  })

  it("persists realtime cursor by waiting out a concurrently held lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-realtime-wait-"))
    await initDriveState(root, "lib_a")
    const lockFile = join(root, ".wspc-drive", "sync.lock")
    await writeFile(lockFile, String(process.pid))
    let sleeps = 0
    const sleep = async () => {
      sleeps += 1
      if (sleeps === 2) await rm(lockFile, { force: true })
    }

    await writeDriveRealtimeState(root, { client_id: "drvcli_abc", last_cursor: "c9" }, { retries: 10, sleep })

    expect((await readDriveState(root)).realtime).toMatchObject({ last_cursor: "c9" })
    expect(sleeps).toBe(2)
  })

  it("creates realtime client ids under the drive lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-ensure-realtime-lock-"))
    await initDriveState(root, "lib_a")

    await withDriveLock(root, async () => {
      await expect(ensureDriveRealtimeState(root)).rejects.toThrow(/sync lock already exists/)
    })
  })

  it("removes lock file after callback throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-release-"))
    await initDriveState(root, "lib_a")

    await expect(
      withDriveLock(root, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    await expect(readFile(join(root, ".wspc-drive", "sync.lock"))).rejects.toThrow()
  })

  it("removes lock file after callback succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-success-"))
    await initDriveState(root, "lib_a")

    const value = await withDriveLock(root, async () => "ok")

    expect(value).toBe("ok")
    await expect(readFile(join(root, ".wspc-drive", "sync.lock"))).rejects.toThrow()
  })

  it("writes and reads schema fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-write-"))
    await initDriveState(root, "lib_a")

    const state: DriveState = {
      schema_version: 1,
      library_id: "lib_a",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      entries: {},
      conflicts: {},
    }

    await writeDriveState(root, state, fixedClock)
    const read = await readDriveState(root)
    expect(read.schema_version).toBe(1)
    expect(read.updated_at).toBe("2026-06-21T10:10:00.123Z")
  })
})

function findDeadPid(): number {
  for (let pid = 99991; pid > 1000; pid -= 7) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return pid
    }
  }
  throw new Error("no dead pid found")
}

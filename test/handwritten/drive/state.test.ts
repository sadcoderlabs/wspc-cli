import { describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initDriveState, readDriveState, withDriveLock, writeDriveState, type DriveState } from "../../../src/handwritten/commands/drive/state.js"

describe("drive state", () => {
  it("creates and reads empty state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_123")
    const state = await readDriveState(root)
    expect(state.library_id).toBe("lib_123")
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

    await writeDriveState(root, state)
    const read = await readDriveState(root)
    expect(read.schema_version).toBe(1)
    expect(read.updated_at).not.toEqual(state.updated_at)
  })
})

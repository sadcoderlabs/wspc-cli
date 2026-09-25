import { createHash } from "node:crypto"
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { initDriveState, readDriveState } from "../../../src/handwritten/commands/drive/state.js"
import { runDriveSyncOnce, type DriveSyncApi } from "../../../src/handwritten/commands/drive/sync.js"
import { DriveHttpError } from "../../../src/handwritten/commands/drive/retry.js"

// Stateful fake of the drive worker: entry rows keyed by id, a coordinator event log
// with cursors, and the same move/upload/delete confirmation checks as files-repo.ts.
type Row = { id: string; path: string; version: number; content: string; versionId: string; deleted: boolean }
type Event = { seq: number; reason: "file_uploaded" | "file_deleted"; row: Row; deletedAt?: string }

function sha(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function fakeServer() {
  const rows = new Map<string, Row>()
  const events: Event[] = []
  let nextId = 1
  let nextVersion = 1
  let failNext: { op: string; error: unknown } | undefined
  const moveErrors: Array<string | undefined> = []
  const active = (path: string) => [...rows.values()].find((r) => r.path === path && !r.deleted)
  const publish = (reason: Event["reason"], row: Row, deletedAt?: string) =>
    events.push({ seq: events.length + 1, reason, row: { ...row }, ...(deletedAt ? { deletedAt } : {}) })
  const toEntry = (row: Row, deletedAt?: string) => ({
    id: row.id,
    path: row.path,
    kind: "file" as const,
    entry_version: row.version,
    current_version_id: row.versionId,
    content_sha256: sha(row.content),
    size_bytes: Buffer.byteLength(row.content),
    updated_at: "2026-09-24T00:00:00.000Z",
    ...(deletedAt ? { deleted_at: deletedAt } : {}),
  })
  const maybeFail = (op: string) => {
    if (failNext?.op === op) {
      const error = failNext.error
      failNext = undefined
      throw error
    }
  }
  const library = { id: "lib_1", org_id: "org_1", name: "personal", version: 1, file_count: 0, storage_bytes: 0, created_by_user_id: "usr_1", created_at: 1, updated_at: 2 }
  const cursor = () => (events.length === 0 ? undefined : `c${events.length}`)

  const server = {
    moveErrors,
    activePaths: () => [...rows.values()].filter((r) => !r.deleted).map((r) => r.path).sort(),
    failNext(op: string, error: unknown) {
      failNext = { op, error }
    },
    // Another device / web / MCP writes the file.
    remoteWrite(path: string, content: string) {
      const row = active(path)
      if (row) {
        row.version += 1
        row.content = content
        row.versionId = `ver_${nextVersion++}`
        publish("file_uploaded", row)
      } else {
        const created: Row = { id: `ent_${nextId++}`, path, version: 1, content, versionId: `ver_${nextVersion++}`, deleted: false }
        rows.set(created.id, created)
        publish("file_uploaded", created)
      }
    },
    remoteMove(from: string, to: string) {
      const row = active(from)!
      row.path = to
      row.version += 1
      publish("file_deleted", { ...row, path: from }, "2026-09-24T00:00:00.000Z")
      publish("file_uploaded", row)
    },
    api: {
      async getManifest(_id: string, _cursor?: string, sinceCursor?: string) {
        maybeFail("manifest")
        if (sinceCursor !== undefined) {
          const since = Number(sinceCursor.slice(1))
          const byPath = new Map<string, Event>()
          for (const event of events.filter((e) => e.seq > since)) byPath.set(event.row.path, event)
          const entries = [...byPath.values()].map((e) => toEntry(e.row, e.reason === "file_deleted" ? e.deletedAt : undefined))
          return { library, entries, next_cursor: null, ...(cursor() ? { latest_cursor: cursor()! } : {}) }
        }
        const entries = [...rows.values()].filter((r) => !r.deleted).map((r) => toEntry(r))
        return { library, entries, next_cursor: null, ...(cursor() ? { latest_cursor: cursor()! } : {}) }
      },
      async uploadFile(_id: string, path: string, body: BodyInit, _digest: string, expected?: number) {
        maybeFail("upload")
        const content = typeof body === "string" ? body : Buffer.from(await new Response(body).arrayBuffer()).toString("utf8")
        const row = active(path)
        if ((row?.version ?? 0) !== (expected ?? 0)) throw new DriveHttpError(409, { code: "VERSION_CONFLICT" })
        server.remoteWrite(path, content)
        return { entry: toEntry(active(path)!), result: row ? ("updated" as const) : ("created" as const) }
      },
      async downloadFile(_id: string, path: string, versionId?: string) {
        maybeFail("download")
        const row = active(path)
        if (!row || (versionId !== undefined && row.versionId !== versionId)) throw new DriveHttpError(404, { code: "NOT_FOUND" })
        return new Response(row.content)
      },
      async deleteFile(_id: string, path: string, expected: number, entryId: string) {
        maybeFail("delete")
        const row = rows.get(entryId)
        if (!row || row.deleted || row.path !== path || row.version !== expected) throw new DriveHttpError(409, { code: "VERSION_CONFLICT" })
        row.deleted = true
        row.version += 1
        publish("file_deleted", row, "2026-09-24T00:00:00.000Z")
        return { entry: toEntry(row, "2026-09-24T00:00:00.000Z"), result: "deleted" }
      },
      async moveFile(_id: string, from: string, to: string, expected: number, entryId: string) {
        maybeFail("move")
        const row = rows.get(entryId)
        let code: string | undefined
        if (!row || row.deleted || row.path !== from || row.version !== expected) code = "VERSION_CONFLICT"
        else if (active(to)) code = "PATH_CONFLICT"
        moveErrors.push(code)
        if (code) throw new DriveHttpError(409, { code })
        server.remoteMove(from, to)
        return { entry: toEntry(row!), result: "moved" as const }
      },
    } satisfies DriveSyncApi,
  }
  return server
}

async function syncedFolder(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-409-"))
  await initDriveState(root, "lib_1")
  const server = fakeServer()
  for (const [path, content] of Object.entries(files)) server.remoteWrite(path, content)
  await runDriveSyncOnce(root, server.api)
  return { root, server }
}

describe("drive sync interrupted mid-round", () => {
  it("a remote edit seen by an interrupted sync still reaches the folder on the next sync", async () => {
    const { root, server } = await syncedFolder({ "notes.md": "v1\n" })
    server.remoteWrite("notes.md", "v2 from another device\n")

    server.failNext("download", new TypeError("fetch failed"))
    await expect(runDriveSyncOnce(root, server.api)).rejects.toThrow("fetch failed")

    await runDriveSyncOnce(root, server.api)
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("v2 from another device\n")
  })

  it("a local rename after an interrupted sync does not wedge every later sync on HTTP 409", async () => {
    const { root, server } = await syncedFolder({ "notes.md": "v1\n" })
    server.remoteWrite("notes.md", "v2 from another device\n")
    server.failNext("download", new TypeError("fetch failed"))
    await expect(runDriveSyncOnce(root, server.api)).rejects.toThrow("fetch failed")

    await rename(join(root, "notes.md"), join(root, "renamed.md"))

    const outcomes: string[] = []
    for (let run = 0; run < 3; run++) {
      outcomes.push(await runDriveSyncOnce(root, server.api).then(() => "ok", (error: Error) => error.message))
    }
    expect(outcomes).toEqual(["ok", "ok", "ok"])
  })

  // Production timeline 2026-09-24 (personal library): a bulk local rename made the CLI
  // run ~320 moves (~2 s each, no progress shown). The watch was stopped twice mid-moves;
  // the first sync after the second stop got HTTP 409 on move and never recovered.
  it("a bulk rename interrupted twice mid-move converges instead of wedging on HTTP 409", async () => {
    const { root, server } = await syncedFolder({ "a.md": "a\n", "b.md": "b\n", "c.md": "c\n", "d.md": "d\n" })
    for (const name of ["a", "b", "c", "d"]) await rename(join(root, `${name}.md`), join(root, `${name}-renamed.md`))

    // The server applies a move but the round dies before the CLI records it (watch stopped, or the response is lost).
    const moveFile = server.api.moveFile.bind(server.api)
    let killAfterMove: string | undefined
    server.api.moveFile = async (id, from, to, expected, entryId) => {
      const moved = await moveFile(id, from, to, expected, entryId)
      if (from === killAfterMove) throw new TypeError("fetch failed")
      return moved
    }

    killAfterMove = "b.md"
    await expect(runDriveSyncOnce(root, server.api)).rejects.toThrow("fetch failed")
    killAfterMove = "c.md"
    await expect(runDriveSyncOnce(root, server.api)).rejects.toThrow("fetch failed")
    killAfterMove = undefined

    const outcomes: string[] = []
    for (let run = 0; run < 3; run++) {
      outcomes.push(await runDriveSyncOnce(root, server.api).then(() => "ok", (error: Error) => error.message))
    }
    expect(outcomes).toEqual(["ok", "ok", "ok"])
    const renamed = ["a-renamed.md", "b-renamed.md", "c-renamed.md", "d-renamed.md"]
    expect(Object.keys((await readDriveState(root)).entries).sort()).toEqual(renamed)
    expect(server.activePaths()).toEqual(renamed)
    expect(server.moveErrors).toEqual([undefined, undefined, undefined, undefined])
  })
})

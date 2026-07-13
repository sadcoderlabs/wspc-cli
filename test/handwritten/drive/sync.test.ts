import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DateTime } from "luxon"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { initDriveState, readDriveState, writeDriveState, type DriveStateEntry } from "../../../src/handwritten/commands/drive/state.js"
import { driveSyncCommand, runDriveSyncOnce, type DriveSyncApi } from "../../../src/handwritten/commands/drive/sync.js"
import { render } from "../../../src/handwritten/output/render.js"
import type { UploadDriveFileResponse } from "../../../src/generated/sdk/index.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const stateWriteControl = vi.hoisted(() => ({
  failNext: undefined as undefined | ((state: unknown) => Error | undefined),
}))

const scannerControl = vi.hoisted(() => ({
  afterHash: undefined as undefined | ((path: string) => Promise<void> | void),
  // Inject a scanner path error for an otherwise unrepresentable local name.
  // A real backslash filename can't exist on Windows (it's a path separator),
  // so we surface the error through onPathError instead of the filesystem.
  injectLocalPathError: undefined as undefined | string,
}))

vi.mock("../../../src/handwritten/commands/drive/state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/handwritten/commands/drive/state.js")>()
  return {
    ...actual,
    writeDriveState: vi.fn(async (root: string, state: unknown, clock?: DriveClock) => {
      const fail = stateWriteControl.failNext?.(state)
      if (fail) {
        stateWriteControl.failNext = undefined
        throw fail
      }
      await actual.writeDriveState(root, state as Parameters<typeof actual.writeDriveState>[1], clock)
    }),
  }
})

vi.mock("../../../src/handwritten/commands/drive/scanner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/handwritten/commands/drive/scanner.js")>()
  return {
    ...actual,
    hashDriveFile: vi.fn(async (path: string) => {
      const result = await actual.hashDriveFile(path)
      await scannerControl.afterHash?.(path)
      return result
    }),
    scanDriveFiles: vi.fn(async (root: string, options?: Parameters<typeof actual.scanDriveFiles>[1]) => {
      const badPath = scannerControl.injectLocalPathError
      if (badPath !== undefined) {
        await options?.onPathError?.(badPath, new Error("invalid drive path: backslash"))
      }
      return actual.scanDriveFiles(root, options)
    }),
  }
})

vi.mock("../../../src/handwritten/output/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/handwritten/output/render.js")>()
  return {
    ...actual,
    render: vi.fn(),
  }
})

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function entry(path: string, content: string, version = 1): ManifestEntry {
  return {
    id: `ent_${path.replace(/[^a-z0-9]/gi, "_")}_${version}`,
    path,
    kind: "file",
    entry_version: version,
    current_version_id: `ver_${version}`,
    content_sha256: sha256(content),
    size_bytes: Buffer.byteLength(content),
    updated_at: "2026-06-21T00:00:00.000Z",
  }
}

function stateEntry(path: string, content: string, version = 1): DriveStateEntry {
  const remote = entry(path, content, version)
  return {
    entry_id: remote.id,
    entry_version: remote.entry_version,
    current_version_id: remote.current_version_id,
    content_sha256: remote.content_sha256,
    size_bytes: remote.size_bytes,
    last_local_sha256: remote.content_sha256,
    last_synced_at: "2026-06-21T00:00:00.000Z",
    status: "synced",
  }
}

const conflictClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00Z", { setZone: true }),
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
  deleted_at?: string
}

type TestDriveSyncApi = DriveSyncApi & {
  manifests: string[]
  uploads: Array<{ id: string; path: string; sha256: string; expectedEntryVersion?: number }>
  deletes: Array<{ id: string; path: string; expectedEntryVersion: number }>
  downloads: Map<string, string>
}

function mkApi(manifestPages: Array<{ entries: ManifestEntry[]; next_cursor?: string | null }>): TestDriveSyncApi {
  const downloads = new Map<string, string>()
  const api: TestDriveSyncApi = {
    manifests: [],
    uploads: [],
    deletes: [],
    downloads,
    async getManifest(_id, cursor) {
      api.manifests.push(cursor ?? "")
      const page = manifestPages.shift()
      if (!page) throw new Error("unexpected manifest page")
      return {
        library: {
          id: "lib_1",
          org_id: "org_1",
          name: "Docs",
          version: 1,
          file_count: page.entries.length,
          storage_bytes: 0,
          created_by_user_id: "usr_1",
          created_at: 1,
          updated_at: 2,
        },
        entries: page.entries,
        next_cursor: page.next_cursor ?? null,
      }
    },
    async uploadFile(id, path, body, digest, expectedEntryVersion) {
      api.uploads.push({ id, path, sha256: digest, expectedEntryVersion })
      const content = typeof body === "string" ? body : Buffer.from(await new Response(body).arrayBuffer()).toString("utf8")
      const result: UploadDriveFileResponse = {
        entry: entry(path, content, expectedEntryVersion === 0 ? 1 : (expectedEntryVersion ?? 0) + 1),
        result: expectedEntryVersion === 0 ? "created" : "updated",
      }
      return result
    },
    async downloadFile(_id, path, versionId) {
      const key = versionId === undefined ? path : `${path}@${versionId}`
      const content = downloads.get(key)
      if (content === undefined) throw new Error(`missing test download: ${key}`)
      return new Response(content)
    },
    async deleteFile(id, path, expectedEntryVersion) {
      api.deletes.push({ id, path, expectedEntryVersion })
      return { entry: { ...entry(path, "", expectedEntryVersion + 1), deleted_at: "2026-06-21T00:00:00.000Z" }, result: "deleted" }
    },
  }
  return api
}

describe("drive sync once", () => {
  beforeEach(() => {
    process.exitCode = undefined
    stateWriteControl.failNext = undefined
    scannerControl.afterHash = undefined
    scannerControl.injectLocalPathError = undefined
    vi.clearAllMocks()
  })

  it("uploads a new local file and updates state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "hello")
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.uploaded).toBe(1)
    expect(result.paths).toEqual([{ path: "notes.txt", action: "upload_create" }])
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.txt", sha256: sha256("hello"), expectedEntryVersion: 0 }])
    const state = await readDriveState(root)
    expect(state.entries["notes.txt"]).toMatchObject({
      entry_id: expect.stringContaining("ent_notes_txt"),
      entry_version: 1,
      current_version_id: "ver_1",
      content_sha256: sha256("hello"),
      size_bytes: 5,
      last_local_sha256: sha256("hello"),
      status: "synced",
    })
  })

  it("reports progress over actionable paths only, excluding unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-progress-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["same.txt"] = stateEntry("same.txt", "same", 2)
    await writeDriveState(root, state)
    await writeFile(join(root, "same.txt"), "same")
    await writeFile(join(root, "new.txt"), "hello")
    const remote = entry("remote.txt", "remote", 3)
    const api = mkApi([{ entries: [entry("same.txt", "same", 2), remote] }])
    api.downloads.set("remote.txt", "remote")
    const progress: Array<[number, number]> = []

    const result = await runDriveSyncOnce(root, api, undefined, (processed, total) => {
      progress.push([processed, total])
    })

    expect(result.uploaded).toBe(1)
    expect(result.downloaded).toBe(1)
    expect(result.unchanged).toBe(1)
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it("includes merged count and conflict copy metadata in sync summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-summary-shape-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.merged).toBe(0)
    expect(result.conflict_paths).toEqual([])
  })

  it("downloads a remote file via temp rename and updates state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-"))
    await initDriveState(root, "lib_1")
    const remote = entry("docs/readme.md", "remote", 3)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("docs/readme.md", "remote")

    const result = await runDriveSyncOnce(root, api)

    expect(result.downloaded).toBe(1)
    expect(await readFile(join(root, "docs", "readme.md"), "utf8")).toBe("remote")
    const state = await readDriveState(root)
    expect(state.entries["docs/readme.md"]).toMatchObject({
      entry_id: remote.id,
      entry_version: 3,
      current_version_id: "ver_3",
      content_sha256: sha256("remote"),
      size_bytes: 6,
      last_local_sha256: sha256("remote"),
      status: "synced",
    })
    await expect(readFile(join(root, "docs", ".readme.md.wspc-download.tmp"), "utf8")).rejects.toThrow()
  })

  it("stops after a local download when state write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-state-fail-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "b.txt"), "b")
    const api = mkApi([{ entries: [entry("a.txt", "remote", 3)] }])
    api.downloads.set("a.txt", "remote")
    stateWriteControl.failNext = (candidate) => {
      const state = candidate as { entries?: Record<string, unknown> }
      if (state.entries?.["a.txt"] && !state.entries?.["b.txt"]) {
        return new Error("state write failed once")
      }
      return undefined
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(api.uploads).toEqual([])
    expect(result.paths).toEqual([{ path: "a.txt", action: "error" }])
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("remote")
    expect((await readDriveState(root)).entries["a.txt"]).toBeUndefined()
  })

  it("delete_remote for local deleted while remote unchanged calls delete API and removes state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-remote-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone.txt"] = stateEntry("gone.txt", "base", 4)
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("gone.txt", "base", 4)] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.deleted).toBe(1)
    expect(api.deletes).toEqual([{ id: "lib_1", path: "gone.txt", expectedEntryVersion: 4 }])
    expect((await readDriveState(root)).entries["gone.txt"]).toBeUndefined()
  })

  it("delete_local for remote gone while local unchanged removes local file and state without calling delete API", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-local-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone-local.txt"] = stateEntry("gone-local.txt", "base", 2)
    await writeDriveState(root, state)
    await writeFile(join(root, "gone-local.txt"), "base")
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.deleted).toBe(1)
    expect(api.deletes).toEqual([])
    await expect(readFile(join(root, "gone-local.txt"), "utf8")).rejects.toThrow()
    expect((await readDriveState(root)).entries["gone-local.txt"]).toBeUndefined()
  })

  it("stops after a local delete when state write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-local-state-fail-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.txt"] = stateEntry("a.txt", "base", 2)
    await writeDriveState(root, state)
    await writeFile(join(root, "a.txt"), "base")
    await writeFile(join(root, "b.txt"), "b")
    const api = mkApi([{ entries: [] }])
    stateWriteControl.failNext = (candidate) => {
      const state = candidate as { entries?: Record<string, unknown> }
      if (!state.entries?.["a.txt"] && !state.entries?.["b.txt"]) {
        return new Error("state write failed once")
      }
      return undefined
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.deleted).toBe(0)
    expect(api.uploads).toEqual([])
    expect(result.paths).toEqual([{ path: "a.txt", action: "error" }])
    await expect(readFile(join(root, "a.txt"), "utf8")).rejects.toThrow()
    expect((await readDriveState(root)).entries["a.txt"]).toEqual(state.entries["a.txt"])
  })

  it("conflict action records conflict and does not mutate existing state entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "local")
    const api = mkApi([{ entries: [entry("notes.txt", "remote", 2)] }])
    api.downloads.set("notes.txt@ver_1", "base")
    api.downloads.set("notes.txt@ver_2", "remote")

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    const after = await readDriveState(root)
    expect(after.entries["notes.txt"]).toEqual(state.entries["notes.txt"])
    expect(after.conflicts["notes.txt"]).toMatchObject({
      reason: "local_and_remote_changed",
      remote_entry_version: 2,
      remote_version_id: "ver_2",
    })
  })

  it("clean merges local and remote text edits, uploads merged content with remote entry version, and updates state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-clean-merge-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "a\nb\nc\n")
    api.downloads.set("notes.md@ver_2", "a\nb\nremote\nc\n")

    const result = await runDriveSyncOnce(root, api)

    expect(result.merged).toBe(1)
    expect(result.conflicts).toBe(0)
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.md", sha256: sha256("a\nlocal\nb\nremote\nc\n"), expectedEntryVersion: 2 }])
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("a\nlocal\nb\nremote\nc\n")
    expect((await readDriveState(root)).conflicts["notes.md"]).toBeUndefined()
  })

  it("writes a remote conflict copy for unclean edit/edit merges without changing the canonical local file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")

    const result = await runDriveSyncOnce(root, api)

    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
    expect(result.conflicts).toBe(1)
    expect(result.conflict_paths[0]).toMatch(/^notes\.remote-conflict-\d{8}T\d{6}Z-ver_2\.md$/)
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("remote\n")
    expect(result.paths).toEqual([
      { path: "notes.md", action: "conflict", conflict_paths: [result.conflict_paths[0]!] },
    ])
    expect(api.uploads).toEqual([])
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "local_and_remote_changed",
      type: "edit_edit",
      strategy: "conflict_copy",
      base_version_id: "ver_1",
      remote_version_id: "ver_2",
      remote_entry_version: 2,
      conflict_paths: [result.conflict_paths[0]!],
    })
  })

  it("writes a remote conflict copy for create/create without a shared base", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-create-create-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.md"), "local\n")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_2", "remote\n")

    const result = await runDriveSyncOnce(root, api)

    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
    expect(result.conflicts).toBe(1)
    expect(result.conflict_paths[0]).toMatch(/^notes\.remote-conflict-\d{8}T\d{6}Z-ver_2\.md$/)
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("remote\n")
    expect(api.uploads).toEqual([])
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "local_and_remote_without_base",
      type: "create_create",
      strategy: "conflict_copy",
      remote_version_id: "ver_2",
      remote_entry_version: 2,
      conflict_paths: [result.conflict_paths[0]!],
    })
  })

  it("reuses an existing conflict copy for the same unresolved edit/edit conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-reuse-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }, { entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")

    const first = await runDriveSyncOnce(root, api, conflictClock)
    const firstState = await readDriveState(root)
    const second = await runDriveSyncOnce(root, api, conflictClock)
    const secondState = await readDriveState(root)

    expect(first.conflict_paths).toEqual(["notes.remote-conflict-20260621T101000Z-ver_2.md"])
    expect(second.conflict_paths).toEqual(first.conflict_paths)
    expect(second.conflicts).toBe(1)
    expect(second.paths).toContainEqual({
      path: "notes.md",
      action: "conflict",
      conflict_paths: first.conflict_paths,
    })
    expect(firstState.conflicts["notes.md"]?.conflict_paths).toEqual(first.conflict_paths)
    expect(secondState.conflicts["notes.md"]?.conflict_paths).toEqual(first.conflict_paths)
    expect(secondState.conflicts["notes.md"]).toEqual(firstState.conflicts["notes.md"])
    expect((await readdir(root)).filter((name) => name.includes(".remote-conflict-"))).toEqual([
      "notes.remote-conflict-20260621T101000Z-ver_2.md",
    ])
  })

  it("recreates a missing conflict copy for the same unresolved edit/edit conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-missing-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }, { entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")
    const originalDownloadFile = api.downloadFile
    api.downloadFile = vi.fn(originalDownloadFile)

    const first = await runDriveSyncOnce(root, api, conflictClock)
    await unlink(join(root, first.conflict_paths[0]!))
    const second = await runDriveSyncOnce(root, api, conflictClock)

    expect(second.conflict_paths).toEqual(first.conflict_paths)
    expect(await readFile(join(root, second.conflict_paths[0]!), "utf8")).toBe("remote\n")
    expect(api.downloadFile).toHaveBeenCalledWith("lib_1", "notes.md", "ver_2")
    expect(vi.mocked(api.downloadFile).mock.calls.filter((call) => call[2] === "ver_2")).toHaveLength(4)
  })

  it("adds a numeric suffix when the conflict copy path already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-suffix-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    await writeFile(join(root, "notes.remote-conflict-20260621T101000Z-ver_2.md"), "existing")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")

    const result = await runDriveSyncOnce(root, api, conflictClock)

    expect(result.conflict_paths).toEqual(["notes.remote-conflict-20260621T101000Z-ver_2-2.md"])
    expect(await readFile(join(root, "notes.remote-conflict-20260621T101000Z-ver_2-2.md"), "utf8")).toBe("remote\n")
    expect(await readFile(join(root, "notes.remote-conflict-20260621T101000Z-ver_2.md"), "utf8")).toBe("existing")
  })

  it("fails a clean merge without deleting the backed up local edit when the target is recreated", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-install-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    const localPath = join(root, "notes.md")
    await writeFile(localPath, "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "a\nb\nc\n")
    api.downloads.set("notes.md@ver_2", "a\nb\nremote\nc\n")
    scannerControl.afterHash = async (path) => {
      if (path.includes(".notes.md.wspc-backup-")) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "recreated during merge")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.merged).toBe(0)
    expect(api.uploads).toEqual([])
    expect(await readFile(localPath, "utf8")).toBe("recreated during merge")
    const backups = (await readdir(root)).filter((name) => name.includes(".notes.md.wspc-backup-"))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(root, backups[0]!), "utf8")).toBe("a\nlocal\nb\nc\n")
    expect((await readDriveState(root)).entries["notes.md"]).toEqual(state.entries["notes.md"])
  })

  it("records a conflict when a versioned base download is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-missing-base-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloadFile = vi.fn(async (_id, _path, versionId) => {
      if (versionId === "ver_1") {
        throw new Error("HTTP 404: missing version")
      }
      return new Response("a\nb\nremote\nc\n")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.conflict_paths[0]).toMatch(/^notes\.remote-conflict-\d{8}T\d{6}Z-ver_2\.md$/)
    expect(api.uploads).toEqual([])
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("a\nlocal\nb\nc\n")
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("a\nb\nremote\nc\n")
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "local_and_remote_changed",
      type: "edit_edit",
      strategy: "conflict_copy",
      remote_version_id: "ver_2",
      conflict_paths: [result.conflict_paths[0]!],
    })
  })

  it("records a remote tombstone conflict when local changed and remote deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-edit-delete-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "base\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect(result.conflicts).toBe(1)
    expect(result.conflict_paths).toEqual([])
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "local_changed_remote_deleted",
      type: "edit_delete",
      strategy: "record_only",
    })
  })

  it("writes a remote conflict copy when local deleted and remote edited", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-edit-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "base\n", 1)
    await writeDriveState(root, state)
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_2", "remote\n")

    const result = await runDriveSyncOnce(root, api)

    await expect(readFile(join(root, "notes.md"), "utf8")).rejects.toThrow()
    expect(result.conflicts).toBe(1)
    expect(result.conflict_paths[0]).toMatch(/^notes\.remote-conflict-\d{8}T\d{6}Z-ver_2\.md$/)
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("remote\n")
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "remote_changed_before_delete",
      type: "delete_edit",
      strategy: "conflict_copy",
      base_version_id: "ver_1",
      remote_version_id: "ver_2",
      remote_entry_version: 2,
      conflict_paths: [result.conflict_paths[0]!],
    })
  })

  it("records a conflict when the local file changes before merged write", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-prewrite-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    const localPath = join(root, "notes.md")
    await writeFile(localPath, "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "a\nb\nc\n")
    api.downloads.set("notes.md@ver_2", "a\nb\nremote\nc\n")
    scannerControl.afterHash = async (path) => {
      if (path === localPath) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "changed during merge\n")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(await readFile(localPath, "utf8")).toBe("changed during merge\n")
    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect(api.uploads).toEqual([])
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "local_changed_during_merge",
      type: "edit_edit",
      strategy: "record_only",
    })
  })

  it("records conflict instead of retrying when merged upload receives VERSION_CONFLICT", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-upload-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "a\nb\nc\n")
    api.downloads.set("notes.md@ver_2", "a\nb\nremote\nc\n")
    api.uploadFile = vi.fn(async () => {
      const error = new Error("HTTP 409: VERSION_CONFLICT") as Error & { code: string }
      error.code = "VERSION_CONFLICT"
      throw error
    })

    const result = await runDriveSyncOnce(root, api)

    expect(api.uploadFile).toHaveBeenCalledTimes(1)
    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("a\nlocal\nb\nc\n")
    expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({
      reason: "VERSION_CONFLICT",
    })
  })

  it("does not overwrite a new local edit while restoring after merged upload conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-upload-restore-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    const localPath = join(root, "notes.md")
    await writeFile(localPath, "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "a\nb\nc\n")
    api.downloads.set("notes.md@ver_2", "a\nb\nremote\nc\n")
    api.uploadFile = vi.fn(async () => {
      const error = new Error("HTTP 409: VERSION_CONFLICT") as Error & { code: string }
      error.code = "VERSION_CONFLICT"
      throw error
    })
    scannerControl.afterHash = async (path) => {
      if (path.includes(".notes.md.wspc-merge-restore-")) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "new edit during restore\n")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect(await readFile(localPath, "utf8")).toBe("new edit during restore\n")
    const backups = (await readdir(root)).filter((name) => name.includes(".notes.md.wspc-backup-"))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(root, backups[0]!), "utf8")).toBe("a\nlocal\nb\nc\n")
    expect((await readdir(root)).filter((name) => name.includes(".notes.md.wspc-merge-restore-"))).toEqual([])
  })

  it("keeps transient versioned download failures as path errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-download-network-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloadFile = vi.fn(async () => {
      throw new Error("ECONNRESET")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.conflicts).toBe(0)
    expect((await readDriveState(root)).conflicts["notes.md"]).toBeUndefined()
  })

  it("reports persisted unresolved conflicts even when no path changes in this run", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-existing-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.conflicts["stuck.txt"] = {
      detected_at: "2026-06-21T00:00:00.000Z",
      reason: "manual_resolution_required",
    }
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.paths).toEqual([{ path: "stuck.txt", action: "conflict" }])
    expect((await readDriveState(root)).conflicts["stuck.txt"]).toEqual(state.conflicts["stuck.txt"])
  })

  it("persists earlier success when a later path errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-partial-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "a.txt"), "ok")
    await writeFile(join(root, "b.txt"), "boom")
    const api = mkApi([{ entries: [] }])
    api.uploadFile = vi.fn(async (_id, path, body, digest, expectedEntryVersion) => {
      if (path === "b.txt") throw new Error("network broke")
      const content = Buffer.from(await new Response(body).arrayBuffer()).toString("utf8")
      return { entry: entry(path, content, expectedEntryVersion === 0 ? 1 : 2), result: "created" as const }
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(1)
    const state = await readDriveState(root)
    expect(state.entries["a.txt"]).toMatchObject({ content_sha256: digestOf("ok"), status: "synced" })
    expect(state.entries["b.txt"]).toBeUndefined()
    expect(state.conflicts["b.txt"]).toBeUndefined()
  })

  it("follows manifest pagination until next cursor is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-pages-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([
      { entries: [entry("a.txt", "a", 1)], next_cursor: "cursor_1" },
      { entries: [entry("b.txt", "b", 1)], next_cursor: null },
    ])
    api.downloads.set("a.txt", "a")
    api.downloads.set("b.txt", "b")

    const result = await runDriveSyncOnce(root, api)

    expect(result.downloaded).toBe(2)
    expect(api.manifests).toEqual(["", "cursor_1"])
  })

  it("records invalid local paths as path errors without uploading them", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-local-"))
    await initDriveState(root, "lib_1")
    scannerControl.injectLocalPathError = "bad\\name.txt"
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.paths).toEqual([{ path: "bad\\name.txt", action: "error" }])
    expect(api.uploads).toEqual([])
    expect((await readDriveState(root)).conflicts["bad\\name.txt"]).toBeUndefined()
  })

  it("records invalid remote paths as path errors without writing outside root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-remote-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([{ entries: [entry("../escape.txt", "remote", 1)] }])
    api.downloads.set("../escape.txt", "remote")

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.paths).toEqual([{ path: "../escape.txt", action: "error" }])
    await expect(readFile(join(root, "..", "escape.txt"), "utf8")).rejects.toThrow()
    expect((await readDriveState(root)).conflicts["../escape.txt"]).toBeUndefined()
  })

  it("records remote case-only path collisions as path errors and skips every ambiguous path", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-remote-case-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([{ entries: [entry("A.txt", "upper", 1), entry("a.txt", "lower", 1)] }])
    api.downloads.set("A.txt", "upper")
    api.downloads.set("a.txt", "lower")

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(2)
    expect(result.downloaded).toBe(0)
    expect(result.paths).toEqual([
      { path: "a.txt", action: "error" },
      { path: "A.txt", action: "error" },
    ])
    await expect(readFile(join(root, "A.txt"), "utf8")).rejects.toThrow()
    await expect(readFile(join(root, "a.txt"), "utf8")).rejects.toThrow()
    expect((await readDriveState(root)).conflicts).toEqual({})
  })

  it("records exact duplicate remote paths as path errors and skips the duplicate path", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-remote-duplicate-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([{ entries: [entry("dup.txt", "first", 1), entry("dup.txt", "second", 2)] }])
    api.downloads.set("dup.txt", "second")

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(2)
    expect(result.downloaded).toBe(0)
    expect(result.paths).toEqual([
      { path: "dup.txt", action: "error" },
      { path: "dup.txt", action: "error" },
    ])
    await expect(readFile(join(root, "dup.txt"), "utf8")).rejects.toThrow()
    expect((await readDriveState(root)).conflicts).toEqual({})
  })

  it("does not write conflicts for generic upload errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-error-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 7)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "local")
    const api = mkApi([{ entries: [entry("notes.txt", "base", 7)] }])
    api.uploadFile = vi.fn(async () => {
      throw new Error("network 500")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    const after = await readDriveState(root)
    expect(after.entries["notes.txt"]).toEqual(state.entries["notes.txt"])
    expect(after.conflicts["notes.txt"]).toBeUndefined()
  })

  it("does not treat arbitrary 409 text as a version conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-409-text-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["bytes.txt"] = stateEntry("bytes.txt", "base", 3)
    await writeDriveState(root, state)
    await writeFile(join(root, "bytes.txt"), "local")
    const api = mkApi([{ entries: [entry("bytes.txt", "base", 3)] }])
    api.uploadFile = vi.fn(async () => {
      throw new Error("file 409 bytes bad")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.conflicts).toBe(0)
    expect((await readDriveState(root)).conflicts["bytes.txt"]).toBeUndefined()
  })

  it("does not treat HTTP 409 quota errors as version conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-http-409-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["quota.txt"] = stateEntry("quota.txt", "base", 3)
    await writeDriveState(root, state)
    await writeFile(join(root, "quota.txt"), "local")
    const api = mkApi([{ entries: [entry("quota.txt", "base", 3)] }])
    api.uploadFile = vi.fn(async () => {
      throw new Error("HTTP 409: quota exceeded")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.conflicts).toBe(0)
    const after = await readDriveState(root)
    expect(after.entries["quota.txt"]).toEqual(state.entries["quota.txt"])
    expect(after.conflicts["quota.txt"]).toBeUndefined()
  })

  it("does not treat status 409 without VERSION_CONFLICT as a version conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-status-409-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["status.txt"] = stateEntry("status.txt", "base", 3)
    await writeDriveState(root, state)
    await writeFile(join(root, "status.txt"), "local")
    const api = mkApi([{ entries: [entry("status.txt", "base", 3)] }])
    api.uploadFile = vi.fn(async () => {
      const error = new Error("quota exceeded") as Error & { status: number }
      error.status = 409
      throw error
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.conflicts).toBe(0)
    expect((await readDriveState(root)).conflicts["status.txt"]).toBeUndefined()
  })

  it("records structured VERSION_CONFLICT upload errors as conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-version-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 5)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "local")
    const api = mkApi([{ entries: [entry("notes.txt", "base", 5)] }])
    api.uploadFile = vi.fn(async () => {
      const error = new Error("stale version") as Error & { code: string }
      error.code = "VERSION_CONFLICT"
      throw error
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect((await readDriveState(root)).conflicts["notes.txt"]).toMatchObject({ reason: "VERSION_CONFLICT" })
  })

  it("records VERSION_CONFLICT text errors as conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-version-conflict-text-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 5)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "local")
    const api = mkApi([{ entries: [entry("notes.txt", "base", 5)] }])
    api.uploadFile = vi.fn(async () => {
      throw new Error("HTTP 409: VERSION_CONFLICT")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.errors).toBe(0)
    expect((await readDriveState(root)).conflicts["notes.txt"]).toMatchObject({ reason: "VERSION_CONFLICT" })
  })

  it("fails download without overwriting when local changed after scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "base")
    const remote = entry("notes.txt", "remote", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.txt", "remote")
    const getManifest = api.getManifest.bind(api)
    api.getManifest = vi.fn(async (id, cursor) => {
      const page = await getManifest(id, cursor)
      await writeFile(join(root, "notes.txt"), "local edit")
      return page
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("local edit")
    expect((await readDriveState(root)).entries["notes.txt"]).toEqual(state.entries["notes.txt"])
  })

  it("fails download without overwriting when local changes while streaming", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-stream-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "base")
    const remote = entry("notes.txt", "remote", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloadFile = vi.fn(async () => {
      await writeFile(join(root, "notes.txt"), "local edit during download")
      return new Response("remote")
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("local edit during download")
    expect((await readDriveState(root)).entries["notes.txt"]).toEqual(state.entries["notes.txt"])
  })

  it("fails download without overwriting a target recreated after backup validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-install-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 1)
    await writeDriveState(root, state)
    const localPath = join(root, "notes.txt")
    await writeFile(localPath, "base")
    const remote = entry("notes.txt", "remote", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.txt", "remote")
    scannerControl.afterHash = async (path) => {
      if (path.includes(".notes.txt.wspc-backup-")) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "recreated after backup")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(await readFile(localPath, "utf8")).toBe("recreated after backup")
    expect((await readDriveState(root)).entries["notes.txt"]).toEqual(state.entries["notes.txt"])
  })

  it("fails delete_local when local changed after scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-local-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone-local.txt"] = stateEntry("gone-local.txt", "base", 2)
    await writeDriveState(root, state)
    await writeFile(join(root, "gone-local.txt"), "base")
    const api = mkApi([{ entries: [] }])
    const getManifest = api.getManifest.bind(api)
    api.getManifest = vi.fn(async (id, cursor) => {
      const page = await getManifest(id, cursor)
      await writeFile(join(root, "gone-local.txt"), "local edit")
      return page
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.deleted).toBe(0)
    expect(await readFile(join(root, "gone-local.txt"), "utf8")).toBe("local edit")
    expect((await readDriveState(root)).entries["gone-local.txt"]).toEqual(state.entries["gone-local.txt"])
  })

  it("fails delete_local without removing a target recreated after backup validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-local-recreate-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone-local.txt"] = stateEntry("gone-local.txt", "base", 2)
    await writeDriveState(root, state)
    const localPath = join(root, "gone-local.txt")
    await writeFile(localPath, "base")
    const api = mkApi([{ entries: [] }])
    scannerControl.afterHash = async (path) => {
      if (path.includes(".gone-local.txt.wspc-backup-")) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "recreated during delete")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.deleted).toBe(0)
    expect(await readFile(localPath, "utf8")).toBe("recreated during delete")
    expect((await readDriveState(root)).entries["gone-local.txt"]).toEqual(state.entries["gone-local.txt"])
  })

  it("fails delete_remote when local file was recreated after scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-remote-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone.txt"] = stateEntry("gone.txt", "base", 4)
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("gone.txt", "base", 4)] }])
    const getManifest = api.getManifest.bind(api)
    api.getManifest = vi.fn(async (id, cursor) => {
      const page = await getManifest(id, cursor)
      await writeFile(join(root, "gone.txt"), "recreated")
      return page
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.deleted).toBe(0)
    expect(api.deletes).toEqual([])
    expect(await readFile(join(root, "gone.txt"), "utf8")).toBe("recreated")
    expect((await readDriveState(root)).entries["gone.txt"]).toEqual(state.entries["gone.txt"])
  })

  it("does not remove a recreated local file after remote delete returns", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-remote-final-race-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone.txt"] = stateEntry("gone.txt", "base", 4)
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("gone.txt", "base", 4)] }])
    api.deleteFile = vi.fn(async (id, path, expectedEntryVersion) => {
      api.deletes.push({ id, path, expectedEntryVersion })
      await writeFile(join(root, "gone.txt"), "recreated during remote delete")
      return { entry: { ...entry(path, "", expectedEntryVersion + 1), deleted_at: "2026-06-21T00:00:00.000Z" }, result: "deleted" }
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.deleted).toBe(0)
    expect(api.deletes).toEqual([{ id: "lib_1", path: "gone.txt", expectedEntryVersion: 4 }])
    expect(await readFile(join(root, "gone.txt"), "utf8")).toBe("recreated during remote delete")
    expect((await readDriveState(root)).entries["gone.txt"]).toEqual(state.entries["gone.txt"])
  })

  it("removes a temp download and preserves the local target when remote hash mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-download-mismatch-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["docs/readme.md"] = stateEntry("docs/readme.md", "base", 1)
    await writeDriveState(root, state)
    await mkdir(join(root, "docs"), { recursive: true })
    await writeFile(join(root, "docs", "readme.md"), "base")
    const remote = { ...entry("docs/readme.md", "expected", 2), content_sha256: sha256("expected") }
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("docs/readme.md", "actual")

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(await readFile(join(root, "docs", "readme.md"), "utf8")).toBe("base")
    const leftoverTemps = (await readdir(join(root, "docs"))).filter((name) => name.includes(".wspc-download-") && name.endsWith(".tmp"))
    expect(leftoverTemps).toEqual([])
    const after = await readDriveState(root)
    expect(after.entries["docs/readme.md"]).toEqual(state.entries["docs/readme.md"])
    expect(after.conflicts["docs/readme.md"]).toBeUndefined()
  })

  it("fails upload when the local file changed after scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-race-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "scan")
    const api = mkApi([{ entries: [] }])
    const getManifest = api.getManifest.bind(api)
    api.getManifest = vi.fn(async (id, cursor) => {
      const page = await getManifest(id, cursor)
      await writeFile(join(root, "notes.txt"), "changed")
      return page
    })

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(api.uploads).toEqual([])
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("changed")
    expect((await readDriveState(root)).entries["notes.txt"]).toBeUndefined()
  })

  it("fails upload when local changes between upload recheck and body read", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-upload-body-race-"))
    await initDriveState(root, "lib_1")
    const localPath = join(root, "notes.txt")
    await writeFile(localPath, "scan")
    const api = mkApi([{ entries: [] }])
    scannerControl.afterHash = async (path) => {
      if (path === localPath) {
        scannerControl.afterHash = undefined
        await writeFile(localPath, "changed before body")
      }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(api.uploads).toEqual([])
    expect(await readFile(localPath, "utf8")).toBe("changed before body")
    expect((await readDriveState(root)).entries["notes.txt"]).toBeUndefined()
  })

  it("stops after a remote mutation when state write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-state-write-fail-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "a.txt"), "a")
    await writeFile(join(root, "b.txt"), "b")
    const api = mkApi([{ entries: [] }])
    stateWriteControl.failNext = (candidate) => {
      const state = candidate as { entries?: Record<string, unknown> }
      if (state.entries?.["a.txt"] && !state.entries?.["b.txt"]) {
        return new Error("state write failed once")
      }
      return undefined
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(api.uploads).toEqual([{ id: "lib_1", path: "a.txt", sha256: sha256("a"), expectedEntryVersion: 0 }])
    expect(result.paths).toEqual([{ path: "a.txt", action: "error" }])
    const after = await readDriveState(root)
    expect(after.entries["a.txt"]).toBeUndefined()
    expect(after.entries["b.txt"]).toBeUndefined()
  })

  it("logs a debug error event for every recorded path error", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-error-event-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "hello")
    const api = mkApi([{ entries: [] }])
    api.uploadFile = async () => {
      throw new Error("upload exploded")
    }
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const debug = { log: (event: string, fields?: Record<string, unknown>) => events.push({ event, fields }) }

    const summary = await runDriveSyncOnce(root, api, undefined, undefined, debug)

    expect(summary.errors).toBe(1)
    const errorEvents = events.filter((candidate) => candidate.event === "error")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]?.fields).toMatchObject({ path: "notes.txt", message: expect.stringContaining("upload exploded") })
  })

  it("logs a debug error event with the fs code for scan path errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-scan-error-event-"))
    await initDriveState(root, "lib_1")
    scannerControl.injectLocalPathError = "gone.txt"
    const api = mkApi([{ entries: [] }])
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const debug = { log: (event: string, fields?: Record<string, unknown>) => events.push({ event, fields }) }

    const summary = await runDriveSyncOnce(root, api, undefined, undefined, debug)

    expect(summary.errors).toBe(1)
    const errorEvents = events.filter((candidate) => candidate.event === "error")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]?.fields).toMatchObject({ path: "gone.txt", message: expect.any(String) })
  })

  it("renders command summary and sets exit code for conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-command-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.txt"] = stateEntry("notes.txt", "base", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.txt"), "local")
    const api = mkApi([{ entries: [entry("notes.txt", "remote", 2)] }])
    api.downloads.set("notes.txt@ver_1", "base")
    api.downloads.set("notes.txt@ver_2", "remote")
    const command = driveSyncCommand(api)

    await command.parseAsync(["node", "sync", "once", root])

    expect(process.exitCode).toBe(1)
    expect(render).toHaveBeenCalledWith(
      { kind: "drive_sync_once", display: { shape: "object" } },
      expect.objectContaining({ conflicts: 1, errors: 0 }),
    )
  })

  it("sets exit code for persisted unresolved conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-command-existing-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.conflicts["stuck.txt"] = {
      detected_at: "2026-06-21T00:00:00.000Z",
      reason: "manual_resolution_required",
    }
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [] }])
    const command = driveSyncCommand(api)

    await command.parseAsync(["node", "sync", "once", root])

    expect(process.exitCode).toBe(1)
    expect(render).toHaveBeenCalledWith(
      { kind: "drive_sync_once", display: { shape: "object" } },
      expect.objectContaining({ conflicts: 1, errors: 0 }),
    )
  })

  it("mounts sync once under source CLI drive help", () => {
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "drive", "sync", "--help"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: undefined, TERM: "xterm-256color" },
    })

    expect(res.status).toBe(0)
    expect(res.stdout).toContain("once")
    expect(res.stdout).toContain("Run one Drive sync pass")
  })
})

function digestOf(content: string): string {
  return sha256(content)
}

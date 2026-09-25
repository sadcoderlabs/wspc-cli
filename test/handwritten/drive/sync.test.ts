import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rename, truncate, unlink, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DateTime } from "luxon"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { initDriveState, readDriveState, writeDriveState, type DriveStateEntry } from "../../../src/handwritten/commands/drive/state.js"
import { driveSyncCommand, runDriveSyncOnce, type DriveSyncApi } from "../../../src/handwritten/commands/drive/sync.js"
import { render } from "../../../src/handwritten/output/render.js"
import type { UploadDriveFileResponse } from "../../../src/generated/sdk/index.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"
import { DriveHttpError, driveHttpError } from "../../../src/handwritten/commands/drive/retry.js"
import { VERSION } from "../../../src/version.js"

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
  deltas: string[]
  uploads: Array<{ id: string; path: string; sha256: string; expectedEntryVersion?: number }>
  deletes: Array<{ id: string; path: string; expectedEntryVersion: number }>
  downloads: Map<string, string>
}

function mkApi(
  manifestPages: Array<{
    entries: ManifestEntry[]
    next_cursor?: string | null
    latest_cursor?: string
    resync_required?: boolean
  }>,
): TestDriveSyncApi {
  const downloads = new Map<string, string>()
  const api: TestDriveSyncApi = {
    manifests: [],
    deltas: [],
    uploads: [],
    deletes: [],
    downloads,
    async getManifest(_id, cursor, sinceCursor) {
      if (sinceCursor !== undefined) api.deltas.push(sinceCursor)
      else api.manifests.push(cursor ?? "")
      const page = manifestPages.shift()
      if (!page) throw new Error("unexpected manifest page")
      return {
        ...(page.latest_cursor === undefined ? {} : { latest_cursor: page.latest_cursor }),
        ...(page.resync_required === undefined ? {} : { resync_required: page.resync_required }),
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

function rejectUploadsOf(api: TestDriveSyncApi, rejectedPath: string, error: () => unknown = () => new DriveHttpError(413)): void {
  const uploadFile = api.uploadFile.bind(api)
  api.uploadFile = async (id, path, body, digest, expectedEntryVersion) => {
    if (path !== rejectedPath) return uploadFile(id, path, body, digest, expectedEntryVersion)
    api.uploads.push({ id, path, sha256: digest, expectedEntryVersion })
    throw error()
  }
}

function uploadCount(api: TestDriveSyncApi, path: string): number {
  return api.uploads.filter((upload) => upload.path === path).length
}

const rejected413 = { path: "big.jsonl", code: "DRIVE_PATH_ERROR", message: "HTTP 413", retryable: false }

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

  it("excludes local, remote, and state-only glob matches at the shared sync boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-exclude-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["packages/web/dist/state.txt"] = stateEntry("packages/web/dist/state.txt", "state")
    state.conflicts["packages/web/dist/conflict.txt"] = {
      detected_at: "2026-06-21T00:00:00.000Z",
      reason: "existing conflict",
    }
    state.scan_cache = {
      "packages/web/dist/cached.txt": {
        mtime_ms: 1,
        size_bytes: 6,
        sha256: sha256("cached"),
      },
    }
    state.scan_errors = {
      "packages/web/dist/error.txt": {
        code: "EPERM",
        message: "blocked",
        retryable: true,
      },
    }
    await writeDriveState(root, state)
    await mkdir(join(root, "packages/web/dist"), { recursive: true })
    await writeFile(join(root, "packages/web/dist/local.txt"), "local")
    await writeFile(join(root, ".wspc-drive/ignore"), "packages/*/dist/\n")
    const api = mkApi([{ entries: [entry("packages/web/dist/remote.txt", "remote")] }])
    api.downloads.set("packages/web/dist/remote.txt", "remote")

    const result = await runDriveSyncOnce(root, api)

    expect(result).toMatchObject({
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      paths: [],
    })
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect(await readFile(join(root, "packages/web/dist/local.txt"), "utf8")).toBe("local")
    await expect(readFile(join(root, "packages/web/dist/remote.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    const nextState = await readDriveState(root)
    expect(nextState.entries).toEqual({})
    expect(nextState.conflicts).toEqual({})
    expect(nextState.scan_cache).toEqual({})
    expect(nextState.scan_errors).toBeUndefined()
  })

  it("reloads exclude rules each round and routes re-included differences through create/create conflict handling", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-reinclude-"))
    const state = await initDriveState(root, "lib_1")
    state.manifest_cursor = "cursor-0"
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const ignorePath = join(root, ".wspc-drive/ignore")
    await writeFile(ignorePath, "notes.md\n")
    const remote = entry("notes.md", "remote\n", 2)
    const excludedApi = mkApi([{ entries: [remote], latest_cursor: "cursor-1" }])

    const excludedResult = await runDriveSyncOnce(root, excludedApi, conflictClock)

    expect(excludedResult.paths).toEqual([])
    expect(excludedApi.deltas).toEqual([])
    await unlink(ignorePath)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_2", "remote\n")

    const reIncludedResult = await runDriveSyncOnce(root, api, conflictClock)

    expect(reIncludedResult.conflicts).toBe(1)
    expect(api.deltas).toEqual([])
    expect(reIncludedResult.paths).toEqual([
      { path: "notes.md", action: "conflict", conflict_paths: [reIncludedResult.conflict_paths[0]!] },
    ])
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.md", sha256: sha256("local\n"), expectedEntryVersion: 2 }])
  })

  it("rejects invalid exclude rules before local, remote, or state mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-exclude-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "base")
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local")
    await writeFile(join(root, ".wspc-drive/ignore"), "../secret\n")
    const before = await readDriveState(root)
    const api = mkApi([{ entries: [entry("notes.md", "remote", 2)] }])

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({
      code: "INVALID_DRIVE_IGNORE",
      retryable: false,
    })

    expect(api.manifests).toEqual([])
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local")
    expect(await readDriveState(root)).toEqual(before)
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

  it("resolves a non-mergeable edit/edit conflict directly with a conflict copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.bin"] = stateEntry("notes.bin", "base", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.bin"), "local")
    const api = mkApi([{ entries: [entry("notes.bin", "remote", 2)] }])
    api.downloads.set("notes.bin@ver_1", "base")
    api.downloads.set("notes.bin@ver_2", "remote")

    const result = await runDriveSyncOnce(root, api)

    expect(result.conflicts).toBe(1)
    expect(result.merged).toBe(0)
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.bin", sha256: sha256("local"), expectedEntryVersion: 2 }])
    const after = await readDriveState(root)
    expect(after.conflicts["notes.bin"]).toBeUndefined()
    expect(after.entries["notes.bin"]).toMatchObject({ entry_version: 3, last_local_sha256: sha256("local") })
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("remote")
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

  it("resolves an unclean edit/edit merge by uploading local as main and keeping a remote conflict copy", async () => {
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
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.md", sha256: sha256("local\n"), expectedEntryVersion: 2 }])
    const nextState = await readDriveState(root)
    expect(nextState.conflicts["notes.md"]).toBeUndefined()
    expect(nextState.entries["notes.md"]).toMatchObject({
      entry_version: 3,
      content_sha256: sha256("local\n"),
      last_local_sha256: sha256("local\n"),
    })
  })

  it("does not report the same edit/edit conflict again on the next sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-once-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    const remoteBefore = entry("notes.md", "remote\n", 2)
    const remoteAfter = entry("notes.md", "local\n", 3)
    const api = mkApi([{ entries: [remoteBefore] }, { entries: [remoteAfter] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")

    const first = await runDriveSyncOnce(root, api, conflictClock)
    expect(first.conflicts).toBe(1)

    const second = await runDriveSyncOnce(root, api, conflictClock)
    expect(second.conflicts).toBe(0)
    // The conflict copy is a new local file, uploaded like any other create.
    expect(api.uploads.map((upload) => upload.path)).toEqual([
      "notes.md",
      "notes.remote-conflict-20260621T101000Z-ver_2.md",
    ])
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
    expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.md", sha256: sha256("local\n"), expectedEntryVersion: 2 }])
    const nextState = await readDriveState(root)
    expect(nextState.conflicts["notes.md"]).toBeUndefined()
    expect(nextState.entries["notes.md"]).toMatchObject({ entry_version: 3, last_local_sha256: sha256("local\n") })
  })

  it("reuses an already written conflict copy when the main upload previously failed", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-reuse-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
    state.conflicts["notes.md"] = {
      detected_at: "2026-06-21T10:10:00.000Z",
      reason: "local_and_remote_changed",
      type: "edit_edit",
      strategy: "conflict_copy",
      remote_version_id: "ver_2",
      remote_entry_version: 2,
      conflict_paths: ["notes.remote-conflict-20260621T101000Z-ver_2.md"],
    }
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "local\n")
    await writeFile(join(root, "notes.remote-conflict-20260621T101000Z-ver_2.md"), "remote\n")
    const remote = entry("notes.md", "remote\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloads.set("notes.md@ver_1", "old\n")
    api.downloads.set("notes.md@ver_2", "remote\n")

    const result = await runDriveSyncOnce(root, api, conflictClock)

    expect(result.conflicts).toBe(1)
    expect((await readdir(root)).filter((name) => name.includes(".remote-conflict-"))).toEqual([
      "notes.remote-conflict-20260621T101000Z-ver_2.md",
    ])
    expect(api.uploads.map((upload) => upload.path)).toContain("notes.md")
    expect((await readDriveState(root)).conflicts["notes.md"]).toBeUndefined()
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

  it("resolves via conflict copy when a versioned base download is missing", async () => {
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
    expect(api.uploads).toEqual([
      { id: "lib_1", path: "notes.md", sha256: sha256("a\nlocal\nb\nc\n"), expectedEntryVersion: 2 },
    ])
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("a\nlocal\nb\nc\n")
    expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("a\nb\nremote\nc\n")
    const after = await readDriveState(root)
    expect(after.conflicts["notes.md"]).toBeUndefined()
    expect(after.entries["notes.md"]).toMatchObject({ entry_version: 3 })
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

  it("interrupts the round for transient versioned download failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-download-network-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["notes.md"] = stateEntry("notes.md", "a\nb\nc\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "notes.md"), "a\nlocal\nb\nc\n")
    const remote = entry("notes.md", "a\nb\nremote\nc\n", 2)
    const api = mkApi([{ entries: [remote] }])
    api.downloadFile = vi.fn(async () => {
      throw Object.assign(new Error("socket closed"), { code: "ECONNRESET" })
    })

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({
      name: "DriveRetryableSyncError",
      cause: { code: "ECONNRESET" },
    })
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
      if (path === "b.txt") throw new Error("upload rejected")
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

  it("stops at the first rate limit and resumes from durable progress on the next full sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-rate-limit-"))
    await initDriveState(root, "lib_1")
    for (const path of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await writeFile(join(root, path), path.slice(0, 1))
    }
    const firstApi = mkApi([{ entries: [] }])
    const upload = firstApi.uploadFile.bind(firstApi)
    const attempts: string[] = []
    firstApi.uploadFile = async (...args) => {
      const path = args[1]
      attempts.push(path)
      if (path === "b.txt") throw new DriveHttpError(429, { retryAfterMs: 60_000 })
      return upload(...args)
    }

    await expect(runDriveSyncOnce(root, firstApi)).rejects.toMatchObject({
      name: "DriveRetryableSyncError",
      remaining: 3,
    })
    expect(attempts).toEqual(["a.txt", "b.txt"])
    expect(await readDriveState(root)).toMatchObject({
      entries: {
        "a.txt": { status: "synced" },
      },
    })

    const secondApi = mkApi([{ entries: [entry("a.txt", "a", 1)] }])
    const result = await runDriveSyncOnce(root, secondApi)

    expect(result).toMatchObject({ uploaded: 3, errors: 0 })
    expect(secondApi.uploads.map((candidate) => candidate.path)).toEqual(["b.txt", "c.txt", "d.txt"])
  })

  it("surfaces an upload authorization failure instead of recording a path error", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-auth-failure-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "hello")
    const api = mkApi([{ entries: [] }])
    api.uploadFile = async () => {
      throw new DriveHttpError(401, { code: "UNAUTHORIZED" })
    }

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    })
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

  it("persists invalid scanner paths and reports their structured details", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-ledger-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "bad\nname.md"), "blocked")
    const api = mkApi([{ entries: [] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.path_errors).toEqual([
      {
        path: "bad\nname.md",
        code: "INVALID_DRIVE_PATH",
        message: "invalid drive path: control character",
        retryable: false,
      },
    ])
    expect((await readDriveState(root)).scan_errors).toEqual({
      "bad\nname.md": {
        code: "INVALID_DRIVE_PATH",
        message: "invalid drive path: control character",
        retryable: false,
      },
    })
  })

  it("retains invalid path errors across unrelated incremental scans and clears them after rename", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-incremental-"))
    const invalidPath = "bad\nname.md"
    await initDriveState(root, "lib_1")
    await writeFile(join(root, invalidPath), "blocked")
    await writeFile(join(root, "good.txt"), "good")
    await runDriveSyncOnce(root, mkApi([{ entries: [] }]))

    await writeFile(join(root, "good.txt"), "changed")
    const unrelatedResult = await runDriveSyncOnce(
      root,
      mkApi([{ entries: [entry("good.txt", "good", 1)] }]),
      undefined,
      undefined,
      undefined,
      { dirtyPaths: ["good.txt"] },
    )

    expect(unrelatedResult.path_errors?.map((error) => error.path)).toEqual([invalidPath])
    expect((await readDriveState(root)).scan_errors).toHaveProperty(invalidPath)

    await rename(join(root, invalidPath), join(root, "fixed.md"))
    const renamedResult = await runDriveSyncOnce(
      root,
      mkApi([{ entries: [entry("good.txt", "changed", 2)] }]),
      undefined,
      undefined,
      undefined,
      { dirtyPaths: [invalidPath, "fixed.md"] },
    )

    expect(renamedResult.path_errors).toEqual([])
    expect((await readDriveState(root)).scan_errors).toBeUndefined()
  })

  it("carries scanner path errors when a manifest rate limit interrupts the round", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-rate-limit-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "bad\nname.md"), "blocked")
    const api = mkApi([])
    api.getManifest = async () => {
      throw new DriveHttpError(429, { retryAfterMs: 60_000 })
    }

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({
      name: "DriveRetryableSyncError",
      pathErrors: [
        {
          path: "bad\nname.md",
          code: "INVALID_DRIVE_PATH",
          message: "invalid drive path: control character",
          retryable: false,
        },
      ],
    })
  })

  it("counts the same invalid local and remote path only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-invalid-dedupe-"))
    const invalidPath = "bad\nname.md"
    await initDriveState(root, "lib_1")
    await writeFile(join(root, invalidPath), "local")
    const api = mkApi([{ entries: [entry(invalidPath, "remote", 1)] }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.path_errors).toHaveLength(1)
    expect(result.paths).toEqual([{ path: invalidPath, action: "error" }])
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

  it("records exact duplicate remote paths once and skips the duplicate path", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-remote-duplicate-"))
    await initDriveState(root, "lib_1")
    const api = mkApi([{ entries: [entry("dup.txt", "first", 1), entry("dup.txt", "second", 2)] }])
    api.downloads.set("dup.txt", "second")

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect(result.downloaded).toBe(0)
    expect(result.paths).toEqual([{ path: "dup.txt", action: "error" }])
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
      throw new Error("upload exploded")
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

  it("uses the move API for a same-hash delete + create pair instead of reupload", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)] }])
    const moves: Array<{ from: string; to: string; expected?: number }> = []
    api.moveFile = async (_id, fromPath, toPath, expectedEntryVersion) => {
      moves.push({ from: fromPath, to: toPath, expected: expectedEntryVersion })
      return { entry: entry(toPath, "same content\n", 2), result: "moved" as const }
    }

    const result = await runDriveSyncOnce(root, api)

    expect(moves).toEqual([{ from: "old-name.md", to: "new-name.md", expected: 1 }])
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect(result.errors).toBe(0)
    const after = await readDriveState(root)
    expect(after.entries["old-name.md"]).toBeUndefined()
    expect(after.entries["new-name.md"]).toMatchObject({ entry_version: 2 })
  })

  it("skips the pair without upload or delete when move has a permanent failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-fallback-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)] }])
    api.moveFile = async () => {
      throw new Error("move unsupported")
    }

    const result = await runDriveSyncOnce(root, api)

    expect(result.path_errors).toEqual([
      {
        path: "new-name.md",
        code: "DRIVE_PATH_ERROR",
        message: "move from old-name.md rejected (move unsupported)",
        retryable: false,
      },
    ])
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
  })

  it("does not degrade a rate-limited move into upload and delete", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-rate-limit-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)] }])
    api.moveFile = async () => {
      throw new DriveHttpError(429, { retryAfterMs: 60_000 })
    }

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({
      name: "DriveRetryableSyncError",
      cause: { status: 429 },
    })
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
  })

  it("does not degrade a forbidden move into upload and delete", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-forbidden-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)] }])
    api.moveFile = async () => {
      throw new DriveHttpError(403, { code: "FORBIDDEN" })
    }

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({ status: 403 })
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
  })

  it("does not pair ambiguous same-hash renames", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-ambiguous-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.md"] = stateEntry("a.md", "dup\n", 1)
    state.entries["b.md"] = stateEntry("b.md", "dup\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "c.md"), "dup\n")
    await writeFile(join(root, "d.md"), "dup\n")
    const api = mkApi([
      { entries: [entry("a.md", "dup\n", 1), entry("b.md", "dup\n", 1)] },
    ])
    const moves: unknown[] = []
    api.moveFile = async (_id, fromPath, toPath) => {
      moves.push([fromPath, toPath])
      return { entry: entry(toPath, "dup\n", 2), result: "moved" as const }
    }

    await runDriveSyncOnce(root, api)

    expect(moves).toEqual([])
    expect(api.uploads.map((upload) => upload.path).sort()).toEqual(["c.md", "d.md"])
    expect(api.deletes.map((del) => del.path).sort()).toEqual(["a.md", "b.md"])
  })

  it("persists the scan hash cache in state.json across syncs", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-scan-cache-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "hello")
    const api = mkApi([{ entries: [] }, { entries: [entry("notes.txt", "hello", 1)] }])

    await runDriveSyncOnce(root, api)

    const state = await readDriveState(root)
    expect(state.scan_cache?.["notes.txt"]).toMatchObject({
      sha256: sha256("hello"),
      size_bytes: 5,
      mtime_ms: expect.any(Number),
    })

    // Second sync with unchanged file keeps the cache entry.
    await runDriveSyncOnce(root, api)
    const second = await readDriveState(root)
    expect(second.scan_cache?.["notes.txt"]?.sha256).toBe(sha256("hello"))
  })

  it("fetches a manifest delta when a manifest cursor is stored", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delta-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.txt"] = stateEntry("a.txt", "aaa", 1)
    state.manifest_cursor = "000000000000000005"
    await writeDriveState(root, state)
    await writeFile(join(root, "a.txt"), "aaa")
    const api = mkApi([
      { entries: [entry("b.txt", "bbb", 1)], latest_cursor: "000000000000000007" },
    ])
    api.downloads.set("b.txt", "bbb")

    const result = await runDriveSyncOnce(root, api)

    expect(api.deltas).toEqual(["000000000000000005"])
    expect(api.manifests).toEqual([])
    // a.txt is not in the delta but must survive via the synthesized view.
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("aaa")
    expect(result.downloaded).toBe(1)
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("bbb")
    expect((await readDriveState(root)).manifest_cursor).toBe("000000000000000007")
  })

  it("falls back to a full manifest when the delta cursor expired", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delta-resync-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.txt"] = stateEntry("a.txt", "aaa", 1)
    state.manifest_cursor = "000000000000000001"
    await writeDriveState(root, state)
    await writeFile(join(root, "a.txt"), "aaa")
    const api = mkApi([
      { entries: [], resync_required: true, latest_cursor: "000000000000000009" },
      { entries: [entry("a.txt", "aaa", 1)], latest_cursor: "000000000000000009" },
    ])

    const result = await runDriveSyncOnce(root, api)

    expect(api.deltas).toEqual(["000000000000000001"])
    expect(api.manifests).toEqual([""])
    expect(result.errors).toBe(0)
    expect((await readDriveState(root)).manifest_cursor).toBe("000000000000000009")
  })

  it("applies deleted entries from a manifest delta", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delta-delete-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.txt"] = stateEntry("a.txt", "aaa", 1)
    state.manifest_cursor = "000000000000000005"
    await writeDriveState(root, state)
    await writeFile(join(root, "a.txt"), "aaa")
    const deleted = { ...entry("a.txt", "aaa", 2), deleted_at: "2026-07-13T00:00:00.000Z" }
    const api = mkApi([{ entries: [deleted], latest_cursor: "000000000000000008" }])

    const result = await runDriveSyncOnce(root, api)

    expect(result.deleted).toBe(1)
    const { localFileExists } = await import("../../../src/handwritten/commands/drive/local-mutations.js")
    expect(await localFileExists(join(root, "a.txt"))).toBe(false)
  })

  it("stores the manifest cursor from a full fetch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-cursor-store-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "n.txt"), "n")
    const api = mkApi([{ entries: [], latest_cursor: "000000000000000003" }])

    await runDriveSyncOnce(root, api)

    expect((await readDriveState(root)).manifest_cursor).toBe("000000000000000003")
  })

  it("rescans only dirty paths when a dirty set is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-dirty-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "a.txt"), "aaa")
    await writeFile(join(root, "b.txt"), "bbb")
    const seedApi = mkApi([{ entries: [] }])
    await runDriveSyncOnce(root, seedApi)

    // Tamper a.txt behind the watcher's back; only b.txt is reported dirty.
    await writeFile(join(root, "a.txt"), "tampered-aaa")
    await writeFile(join(root, "b.txt"), "bbb-changed")
    const api = mkApi([
      { entries: [entry("a.txt", "aaa", 1), entry("b.txt", "bbb", 1)] },
    ])

    const result = await runDriveSyncOnce(root, api, undefined, undefined, undefined, {
      dirtyPaths: ["b.txt"],
    })

    expect(api.uploads.map((upload) => upload.path)).toEqual(["b.txt"])
    expect(result.errors).toBe(0)
  })

  it("treats a dirty path that vanished from disk as locally deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-dirty-delete-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["gone.txt"] = stateEntry("gone.txt", "gone", 1)
    state.scan_cache = {
      "gone.txt": { mtime_ms: 1, size_bytes: 4, sha256: sha256("gone") },
    }
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("gone.txt", "gone", 1)] }])

    const result = await runDriveSyncOnce(root, api, undefined, undefined, undefined, {
      dirtyPaths: ["gone.txt"],
    })

    expect(api.deletes.map((del) => del.path)).toEqual(["gone.txt"])
    expect(result.errors).toBe(0)
  })

  it("rescans a dirty directory subtree", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-dirty-dir-"))
    await initDriveState(root, "lib_1")
    await mkdir(join(root, "docs"), { recursive: true })
    await writeFile(join(root, "docs", "x.md"), "x")
    const seedApi = mkApi([{ entries: [] }])
    await runDriveSyncOnce(root, seedApi)

    await writeFile(join(root, "docs", "y.md"), "y")
    const api = mkApi([{ entries: [entry("docs/x.md", "x", 1)] }])

    const result = await runDriveSyncOnce(root, api, undefined, undefined, undefined, {
      dirtyPaths: ["docs"],
    })

    expect(api.uploads.map((upload) => upload.path)).toEqual(["docs/y.md"])
    expect(result.errors).toBe(0)
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

  describe("permanent upload rejection", () => {
    it("uploads an unchanged rejected file only once across rounds and keeps reporting it", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-rejected-"))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      const api = mkApi([{ entries: [] }, { entries: [] }, { entries: [] }])
      rejectUploadsOf(api, "big.jsonl")

      const summaries = []
      const progress: number[] = []
      summaries.push(await runDriveSyncOnce(root, api))
      const recorded = (await readDriveState(root)).upload_rejections?.["big.jsonl"]
      summaries.push(await runDriveSyncOnce(root, api, undefined, (_processed, total) => progress.push(total)))
      summaries.push(await runDriveSyncOnce(root, api))

      expect(uploadCount(api, "big.jsonl")).toBe(1)
      for (const summary of summaries) {
        expect(summary.path_errors).toEqual([rejected413])
        expect(summary.errors).toBe(1)
        expect(summary.paths).toEqual([{ path: "big.jsonl", action: "error" }])
      }
      expect(progress).toEqual([0])
      const scanned = (await readDriveState(root)).scan_cache?.["big.jsonl"]
      expect(recorded).toEqual({
        mtime_ms: scanned?.mtime_ms,
        size_bytes: 4,
        sha256: sha256("huge"),
        code: "DRIVE_PATH_ERROR",
        message: "HTTP 413",
        cli_version: VERSION,
        rejected_at: expect.any(String),
      })
    })

    it("keeps syncing other files around a rejected file", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-rejected-others-"))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      await writeFile(join(root, "notes.txt"), "hello")
      const api = mkApi([{ entries: [] }, { entries: [entry("notes.txt", "hello", 1)] }])
      rejectUploadsOf(api, "big.jsonl")

      const first = await runDriveSyncOnce(root, api)
      await writeFile(join(root, "notes.txt"), "hello again")
      const second = await runDriveSyncOnce(root, api)

      expect(first.uploaded).toBe(1)
      expect(second.uploaded).toBe(1)
      expect(second.path_errors).toEqual([rejected413])
      expect(api.uploads.map((upload) => upload.path)).toEqual(["big.jsonl", "notes.txt", "notes.txt"])
    })

    async function rejectedLibrary(prefix: string, rounds: number): Promise<{ root: string; api: TestDriveSyncApi }> {
      const root = await mkdtemp(join(tmpdir(), prefix))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      const api = mkApi(Array.from({ length: rounds }, () => ({ entries: [] })))
      rejectUploadsOf(api, "big.jsonl")
      await runDriveSyncOnce(root, api)
      return { root, api }
    }

    it("retries once after the content changes", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-content-", 3)
      await writeFile(join(root, "big.jsonl"), "huger")

      await runDriveSyncOnce(root, api)
      await runDriveSyncOnce(root, api)

      expect(uploadCount(api, "big.jsonl")).toBe(2)
      expect((await readDriveState(root)).upload_rejections?.["big.jsonl"]?.sha256).toBe(sha256("huger"))
    })

    it("retries once after only the mtime changes", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-mtime-", 3)
      await utimes(join(root, "big.jsonl"), 1_893_456_000, 1_893_456_000)

      await runDriveSyncOnce(root, api)
      await runDriveSyncOnce(root, api)

      expect(uploadCount(api, "big.jsonl")).toBe(2)
    })

    it("forgets the rejection when the file is deleted", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-delete-", 2)
      await unlink(join(root, "big.jsonl"))

      const result = await runDriveSyncOnce(root, api)

      expect(result.path_errors ?? []).toEqual([])
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it("forgets the rejection when the file is renamed and uploads the new path once", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-rename-", 2)
      await rename(join(root, "big.jsonl"), join(root, "renamed.jsonl"))

      const result = await runDriveSyncOnce(root, api)

      expect(result.path_errors ?? []).toEqual([])
      expect(uploadCount(api, "renamed.jsonl")).toBe(1)
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it("forgets the rejection when the file becomes excluded", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-exclude-", 2)
      await writeFile(join(root, ".wspc-drive", "ignore"), "big.jsonl\n")

      const result = await runDriveSyncOnce(root, api)

      expect(result.path_errors ?? []).toEqual([])
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it("retries once when the rejection was recorded by another CLI version", async () => {
      const { root, api } = await rejectedLibrary("wspc-drive-sync-rejected-version-", 3)
      const state = await readDriveState(root)
      state.upload_rejections!["big.jsonl"]!.cli_version = "0.0.0-older"
      await writeDriveState(root, state)

      await runDriveSyncOnce(root, api)
      await runDriveSyncOnce(root, api)

      expect(uploadCount(api, "big.jsonl")).toBe(2)
      expect((await readDriveState(root)).upload_rejections?.["big.jsonl"]?.cli_version).toBe(VERSION)
    })

    it("removes the rejection once a changed file uploads successfully", async () => {
      const { root } = await rejectedLibrary("wspc-drive-sync-rejected-success-", 1)
      await writeFile(join(root, "big.jsonl"), "small")
      const api = mkApi([{ entries: [] }])

      const result = await runDriveSyncOnce(root, api)

      expect(result.uploaded).toBe(1)
      expect(result.path_errors ?? []).toEqual([])
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it("reports a bare upload 413 as FILE_TOO_LARGE and remembers that code", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-rejected-413-"))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      const api = mkApi([{ entries: [] }])
      rejectUploadsOf(api, "big.jsonl", () => driveHttpError(new Response("", { status: 413 })))

      const result = await runDriveSyncOnce(root, api)

      expect(result.path_errors).toEqual([{ ...rejected413, code: "FILE_TOO_LARGE" }])
      expect((await readDriveState(root)).upload_rejections?.["big.jsonl"]?.code).toBe("FILE_TOO_LARGE")
    })

    it.each([
      ["502", () => new DriveHttpError(502)],
      ["429", () => new DriveHttpError(429)],
      ["408", () => new DriveHttpError(408)],
      ["401", () => new DriveHttpError(401)],
      ["403", () => new DriveHttpError(403)],
      ["VERSION_CONFLICT", () => new DriveHttpError(409, { code: "VERSION_CONFLICT" })],
    ])("does not remember a %s upload failure", async (_name, error) => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-not-rejected-"))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      const api = mkApi([{ entries: [] }])
      rejectUploadsOf(api, "big.jsonl", error)

      await runDriveSyncOnce(root, api).catch(() => undefined)

      expect(uploadCount(api, "big.jsonl")).toBe(1)
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it.each([
      ["a local read error", Object.assign(new Error("permission denied"), { code: "EACCES" })],
      ["a local change after scan", undefined],
    ])("does not remember %s before upload", async (_name, readError) => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-not-rejected-read-"))
      await initDriveState(root, "lib_1")
      await writeFile(join(root, "big.jsonl"), "huge")
      const api = mkApi([{ entries: [] }])
      rejectUploadsOf(api, "big.jsonl")
      const getManifest = api.getManifest.bind(api)
      api.getManifest = vi.fn(async (id, cursor) => {
        const page = await getManifest(id, cursor)
        if (readError === undefined) await writeFile(join(root, "big.jsonl"), "changed")
        else scannerControl.afterHash = () => { throw readError }
        return page
      })

      const result = await runDriveSyncOnce(root, api)

      expect(result.errors).toBe(1)
      expect(uploadCount(api, "big.jsonl")).toBe(0)
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })
  })

  describe("oversized file", () => {
    const overLimit = 104_857_601
    const tooLarge = (path: string) => ({
      path,
      code: "FILE_TOO_LARGE",
      message: "file is 100.0 MiB (104857601 bytes); Drive per-file limit is 100 MiB",
      retryable: false,
    })

    async function sparse(root: string, path: string, size: number): Promise<void> {
      await writeFile(join(root, path), "")
      await truncate(join(root, path), size)
    }

    it("never reads or uploads an oversized file and reports it every round", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-oversized-"))
      await initDriveState(root, "lib_1")
      await sparse(root, "big.bin", overLimit)
      const api = mkApi([{ entries: [] }, { entries: [] }])

      for (let round = 0; round < 2; round++) {
        const summary = await runDriveSyncOnce(root, api)
        expect(summary.path_errors).toEqual([tooLarge("big.bin")])
        expect(summary.errors).toBe(1)
        expect(summary.paths).toEqual([{ path: "big.bin", action: "error" }])
      }
      expect(uploadCount(api, "big.bin")).toBe(0)
    })

    it("leaves an oversized file out of progress and syncs other files", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-oversized-others-"))
      await initDriveState(root, "lib_1")
      await sparse(root, "big.bin", overLimit)
      await writeFile(join(root, "notes.txt"), "hello")
      const api = mkApi([{ entries: [] }])
      const totals: number[] = []

      const summary = await runDriveSyncOnce(root, api, undefined, (_processed, total) => totals.push(total))

      expect(new Set(totals)).toEqual(new Set([1]))
      expect(uploadCount(api, "notes.txt")).toBe(1)
      expect(uploadCount(api, "big.bin")).toBe(0)
      expect(summary.uploaded).toBe(1)
    })

    it("uploads a file of exactly 100 MiB", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-oversized-boundary-"))
      await initDriveState(root, "lib_1")
      await sparse(root, "edge.bin", 104_857_600)
      const api = mkApi([{ entries: [] }])
      const uploadedBytes: number[] = []
      api.uploadFile = async (id, path, body, digest, expectedEntryVersion) => {
        api.uploads.push({ id, path, sha256: digest, expectedEntryVersion })
        uploadedBytes.push((body as ArrayBuffer).byteLength)
        return {
          entry: { ...entry(path, "", 1), content_sha256: digest, size_bytes: 104_857_600 },
          result: "created",
        }
      }

      const summary = await runDriveSyncOnce(root, api)

      expect(uploadedBytes).toEqual([104_857_600])
      expect(summary.path_errors ?? []).toEqual([])
    })

    it("stops uploading a synced file once it grows over the limit", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-oversized-grown-"))
      const state = await initDriveState(root, "lib_1")
      state.entries["big.bin"] = stateEntry("big.bin", "small")
      await writeDriveState(root, state)
      await sparse(root, "big.bin", overLimit)
      const api = mkApi([{ entries: [entry("big.bin", "small")] }])

      const summary = await runDriveSyncOnce(root, api)

      expect(uploadCount(api, "big.bin")).toBe(0)
      expect(summary.path_errors).toEqual([tooLarge("big.bin")])
    })

    async function oversizedLibrary(prefix: string, rounds: number): Promise<{ root: string; api: TestDriveSyncApi }> {
      const root = await mkdtemp(join(tmpdir(), prefix))
      await initDriveState(root, "lib_1")
      await sparse(root, "big.bin", overLimit)
      const api = mkApi(Array.from({ length: rounds }, () => ({ entries: [] })))
      await runDriveSyncOnce(root, api)
      return { root, api }
    }

    it("uploads the file once it shrinks within the limit", async () => {
      const { root, api } = await oversizedLibrary("wspc-drive-sync-oversized-shrink-", 2)
      await writeFile(join(root, "big.bin"), "small")

      const summary = await runDriveSyncOnce(root, api)

      expect(summary.path_errors ?? []).toEqual([])
      expect(uploadCount(api, "big.bin")).toBe(1)
    })

    it.each([
      ["deleted", (root: string) => unlink(join(root, "big.bin"))],
      ["excluded", (root: string) => writeFile(join(root, ".wspc-drive", "ignore"), "big.bin\n")],
    ])("stops reporting the file once it is %s", async (_name, change) => {
      const { root, api } = await oversizedLibrary("wspc-drive-sync-oversized-gone-", 2)
      await change(root)

      const summary = await runDriveSyncOnce(root, api)

      expect(summary.path_errors ?? []).toEqual([])
      expect(uploadCount(api, "big.bin")).toBe(0)
    })

    it("reports the new path after renaming an oversized file", async () => {
      const { root, api } = await oversizedLibrary("wspc-drive-sync-oversized-rename-", 2)
      await rename(join(root, "big.bin"), join(root, "renamed.bin"))

      const summary = await runDriveSyncOnce(root, api)

      expect(summary.path_errors).toEqual([tooLarge("renamed.bin")])
      expect(api.uploads).toEqual([])
    })

    it("replaces a rejection recorded by an older CLI with FILE_TOO_LARGE", async () => {
      const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-oversized-legacy-"))
      await initDriveState(root, "lib_1")
      await sparse(root, "big.bin", overLimit)
      const api = mkApi([{ entries: [] }, { entries: [] }])
      await runDriveSyncOnce(root, api)
      const state = await readDriveState(root)
      const scanned = state.scan_cache!["big.bin"]!
      state.upload_rejections = {
        "big.bin": {
          mtime_ms: scanned.mtime_ms,
          size_bytes: scanned.size_bytes,
          sha256: scanned.sha256,
          code: "DRIVE_PATH_ERROR",
          message: "HTTP 413",
          cli_version: "0.0.0-older",
          rejected_at: "2026-09-15T00:00:00.000Z",
        },
      }
      await writeDriveState(root, state)

      const summary = await runDriveSyncOnce(root, api)

      expect(uploadCount(api, "big.bin")).toBe(0)
      expect(summary.path_errors).toEqual([tooLarge("big.bin")])
      expect((await readDriveState(root)).upload_rejections).toBeUndefined()
    })

    it("reports an oversized file once when a current rejection also matches", async () => {
      const { root, api } = await oversizedLibrary("wspc-drive-sync-oversized-dedupe-", 2)
      const state = await readDriveState(root)
      const scanned = state.scan_cache!["big.bin"]!
      state.upload_rejections = {
        "big.bin": {
          mtime_ms: scanned.mtime_ms,
          size_bytes: scanned.size_bytes,
          sha256: scanned.sha256,
          code: "FILE_TOO_LARGE",
          message: "HTTP 413",
          cli_version: VERSION,
          rejected_at: "2026-09-18T00:00:00.000Z",
        },
      }
      await writeDriveState(root, state)

      const summary = await runDriveSyncOnce(root, api)

      expect(summary.path_errors).toEqual([tooLarge("big.bin")])
      expect(summary.errors).toBe(1)
    })
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

  it("sets a nonzero exit code for a retryable sync-once interruption without retrying", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-command-rate-limit-"))
    await initDriveState(root, "lib_1")
    await writeFile(join(root, "notes.txt"), "hello")
    const api = mkApi([{ entries: [] }])
    api.uploadFile = async () => {
      throw new DriveHttpError(429, { retryAfterMs: 60_000 })
    }
    const command = driveSyncCommand(api)

    await expect(command.parseAsync(["node", "sync", "once", root])).rejects.toMatchObject({
      name: "DriveRetryableSyncError",
    })

    expect(process.exitCode).toBe(1)
    expect(api.uploads).toEqual([])
    expect(render).not.toHaveBeenCalledWith(
      { kind: "drive_sync_once", display: { shape: "object" } },
      expect.anything(),
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

  it("keeps the stored manifest cursor when the round is interrupted after the manifest fetch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-cursor-interrupted-"))
    const state = await initDriveState(root, "lib_1")
    state.manifest_cursor = "000000000000000005"
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("b.txt", "bbb", 1)], latest_cursor: "000000000000000007" }])
    api.downloadFile = async () => {
      throw new TypeError("fetch failed")
    }

    await expect(runDriveSyncOnce(root, api)).rejects.toMatchObject({ name: "DriveRetryableSyncError" })

    expect((await readDriveState(root)).manifest_cursor).toBe("000000000000000005")
  })

  it("keeps the stored manifest cursor when the round stops on a state write failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-cursor-stop-"))
    const state = await initDriveState(root, "lib_1")
    state.manifest_cursor = "000000000000000005"
    await writeDriveState(root, state)
    const api = mkApi([{ entries: [entry("a.txt", "remote", 3)], latest_cursor: "000000000000000007" }])
    api.downloads.set("a.txt", "remote")
    stateWriteControl.failNext = (candidate) =>
      (candidate as { entries?: Record<string, unknown> }).entries?.["a.txt"] ? new Error("state write failed once") : undefined

    const result = await runDriveSyncOnce(root, api)

    expect(result.errors).toBe(1)
    expect((await readDriveState(root)).manifest_cursor).toBe("000000000000000005")
  })

  it("refetches a full manifest instead of stopping when a move is rejected on a delta view", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-stale-delta-"))
    const state = await initDriveState(root, "lib_1")
    // Stale base: the server already moved old-name.md, but the delta that said so was skipped.
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    state.manifest_cursor = "000000000000000005"
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const moved = { ...entry("new-name.md", "same content\n", 2), id: stateEntry("old-name.md", "same content\n", 1).entry_id }
    const api = mkApi([
      { entries: [], latest_cursor: "000000000000000005" },
      { entries: [moved], latest_cursor: "000000000000000009" },
    ])
    const moves: string[] = []
    api.moveFile = async (_id, fromPath, toPath) => {
      moves.push(`${fromPath}->${toPath}`)
      throw new DriveHttpError(409, { code: "VERSION_CONFLICT" })
    }

    const result = await runDriveSyncOnce(root, api)

    expect(moves).toEqual(["old-name.md->new-name.md"])
    expect(api.deltas).toEqual(["000000000000000005"])
    expect(api.manifests).toEqual([""])
    expect(api.uploads).toEqual([])
    expect(api.deletes).toEqual([])
    expect(result.errors).toBe(0)
    const after = await readDriveState(root)
    expect(Object.keys(after.entries)).toEqual(["new-name.md"])
    expect(after.entries["new-name.md"]).toMatchObject({ entry_version: 2 })
    expect(after.manifest_cursor).toBe("000000000000000009")
  })

  it("reports a move rejected on a full view as a path error and keeps syncing other files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-rejected-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    await writeFile(join(root, "other.md"), "other\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)], latest_cursor: "000000000000000003" }])
    api.moveFile = async () => {
      throw new DriveHttpError(409, { code: "PATH_CONFLICT" })
    }

    const result = await runDriveSyncOnce(root, api)

    expect(api.manifests).toEqual([""])
    expect(api.uploads.map((upload) => upload.path)).toEqual(["other.md"])
    expect(api.deletes).toEqual([])
    expect(result.errors).toBe(1)
    expect(result.path_errors).toEqual([
      { path: "new-name.md", code: "PATH_CONFLICT", message: "move from old-name.md rejected (HTTP 409)", retryable: false },
    ])
    expect((await readDriveState(root)).entries["old-name.md"]).toMatchObject({ entry_version: 1 })
  })

  it("logs a move_rejected debug event with the pair, confirmation, and server code", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-rejected-debug-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["old-name.md"] = stateEntry("old-name.md", "same content\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "new-name.md"), "same content\n")
    const api = mkApi([{ entries: [entry("old-name.md", "same content\n", 1)] }])
    api.moveFile = async () => {
      throw new DriveHttpError(409, { code: "PATH_CONFLICT" })
    }
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const debug = { log: (event: string, fields?: Record<string, unknown>) => events.push({ event, fields }) }

    await runDriveSyncOnce(root, api, undefined, undefined, debug)

    expect(events.filter((logged) => logged.event === "move_rejected")).toEqual([
      {
        event: "move_rejected",
        fields: {
          from_path: "old-name.md",
          to_path: "new-name.md",
          entry_id: stateEntry("old-name.md", "same content\n", 1).entry_id,
          expected_entry_version: 1,
          status: 409,
          code: "PATH_CONFLICT",
          action: "skip_pair",
        },
      },
    ])
  })

  it("counts planned moves in progress before running them", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-move-progress-"))
    const state = await initDriveState(root, "lib_1")
    state.entries["a.md"] = stateEntry("a.md", "a\n", 1)
    state.entries["b.md"] = stateEntry("b.md", "b\n", 1)
    await writeDriveState(root, state)
    await writeFile(join(root, "a2.md"), "a\n")
    await writeFile(join(root, "b2.md"), "b\n")
    await writeFile(join(root, "new.md"), "new\n")
    const api = mkApi([{ entries: [entry("a.md", "a\n", 1), entry("b.md", "b\n", 1)] }])
    api.moveFile = async (_id, _fromPath, toPath) => ({
      entry: entry(toPath, toPath === "a2.md" ? "a\n" : "b\n", 2),
      result: "moved" as const,
    })
    const progress: Array<[number, number]> = []

    await runDriveSyncOnce(root, api, undefined, (processed, total) => {
      progress.push([processed, total])
    })

    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })
})

function digestOf(content: string): string {
  return sha256(content)
}

it.each(["delete", "move"])("uses the saved identity for sync %s when another entry has the same path and version", async operation => {
  const root = await mkdtemp(join(tmpdir(), "confirmation-sync-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["a.txt"] = { ...stateEntry("a.txt", "original"), entry_id: "original-id" }
  await writeDriveState(root, state)
  if (operation === "move") await writeFile(join(root, "b.txt"), "original")
  const api = mkApi([{ entries: [{ ...entry("a.txt", "original"), id: "replacement-id" }] }])
  const calls: unknown[][] = []
  const fail = async (...args: unknown[]) => { calls.push(args); throw new DriveHttpError(409, { code: "VERSION_CONFLICT" }) }
  api.deleteFile = fail
  if (operation === "move") api.moveFile = fail
  const result = await runDriveSyncOnce(root, api)
  if (operation === "move") {
    expect(result.path_errors).toEqual([
      { path: "b.txt", code: "VERSION_CONFLICT", message: "move from a.txt rejected (HTTP 409)", retryable: false },
    ])
  } else expect(result.deleted).toBe(0)
  expect(calls).toEqual([operation === "move" ? ["lib_1", "a.txt", "b.txt", 1, "original-id"] : ["lib_1", "a.txt", 1, "original-id"]])
  expect(api.uploads).toEqual([])
  expect((await readDriveState(root)).entries["a.txt"]?.entry_id).toBe("original-id")
})

it("rejects legacy sync state without identity before fetching a manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "confirmation-legacy-"))
  const state = await initDriveState(root, "lib_1")
  const { entry_id, ...legacy } = stateEntry("a.txt", "original")
  await writeFile(join(root, ".wspc-drive/state.json"), JSON.stringify({ ...state, entries: { "a.txt": legacy } }))
  const api = mkApi([{ entries: [entry("a.txt", "replacement")] }])
  await expect(runDriveSyncOnce(root, api)).rejects.toThrow("schema")
  expect(api.manifests).toEqual([])
  expect(api.deletes).toEqual([])
  expect(JSON.parse(await readFile(join(root, ".wspc-drive/state.json"), "utf8")).entries["a.txt"]).toEqual(legacy)
})

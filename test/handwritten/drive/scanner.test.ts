import { createHash } from "node:crypto"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { scanDriveFiles } from "../../../src/handwritten/commands/drive/scanner.js"

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

describe("drive scanner", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises")
  })

  it("includes dotfiles and nested files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-"))
    await mkdir(join(root, "notes"), { recursive: true })
    await mkdir(join(root, "notes", "nested"), { recursive: true })

    await writeFile(join(root, ".secret"), "hidden")
    await writeFile(join(root, "notes", "today.md"), "today")
    await writeFile(join(root, "notes", "nested", "hello.txt"), "hello")

    const files = await scanDriveFiles(root)

    expect(files).toEqual({
      ".secret": {
        sha256: sha256("hidden"),
        size_bytes: 6,
      },
      "notes/today.md": {
        sha256: sha256("today"),
        size_bytes: 5,
      },
      "notes/nested/hello.txt": {
        sha256: sha256("hello"),
        size_bytes: 5,
      },
    })
  })

  it("skips internal sync temp artifacts without excluding ordinary dotfiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-artifacts-"))
    await mkdir(join(root, "docs"), { recursive: true })
    await writeFile(join(root, ".secret"), "hidden")
    await writeFile(join(root, ".notes.txt.wspc-download-123.tmp"), "download tmp")
    await writeFile(join(root, ".notes.txt.wspc-conflict-789.tmp"), "conflict tmp")
    await writeFile(join(root, "docs", ".readme.md.wspc-backup-456.tmp"), "backup tmp")
    await writeFile(join(root, "docs", ".readme.md.wspc-merge-abc.tmp"), "merge tmp")
    await writeFile(join(root, "docs", "readme.md"), "readme")

    const files = await scanDriveFiles(root)

    expect(files).toEqual({
      ".secret": {
        sha256: sha256("hidden"),
        size_bytes: 6,
      },
      "docs/readme.md": {
        sha256: sha256("readme"),
        size_bytes: 6,
      },
    })
  })

  it("excludes .wspc-drive at root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-exclude-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), '{"schema_version":1}')
    await writeFile(join(root, "keep.txt"), "keep")

    const files = await scanDriveFiles(root)

    expect(files).toEqual({
      "keep.txt": {
        sha256: sha256("keep"),
        size_bytes: 4,
      },
    })
  })

  it("skips symlink entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-symlink-"))
    await writeFile(join(root, "target.txt"), "target")
    await symlink("target.txt", join(root, "linked.txt"))

    const files = await scanDriveFiles(root)

    expect(files).toEqual({
      "target.txt": {
        sha256: sha256("target"),
        size_bytes: 6,
      },
    })
    expect(files.linked).toBeUndefined()
    expect(files["linked.txt"]).toBeUndefined()
  })

  it("skips non-regular entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-special-"))
    await mkdir(join(root, "dir"), { recursive: true })
    await writeFile(join(root, "dir", "a.txt"), "in-dir")

    const files = await scanDriveFiles(root)
    expect(Object.keys(files)).toEqual(["dir/a.txt"])
  })

  it("throws on case-only path collisions when no path error handler is provided", async () => {
    const mockedScanDriveFiles = await importScannerWithMockFiles({
      "A.txt": "upper",
      "a.txt": "lower",
    })

    await expect(mockedScanDriveFiles("/mock")).rejects.toThrow(/LOCAL_PATH_CASE_CONFLICT/)
  })

  it("reports and skips every case-only path collision when a path error handler is provided", async () => {
    const errors: Array<{ path: string; message: string }> = []
    const mockedScanDriveFiles = await importScannerWithMockFiles({
      "A.txt": "upper",
      "a.txt": "lower",
      "ok.txt": "ok",
    })

    const files = await mockedScanDriveFiles("/mock", {
      onPathError: (path, error) => {
        errors.push({ path, message: error instanceof Error ? error.message : String(error) })
      },
    })

    expect(files).toEqual({
      "ok.txt": {
        sha256: sha256("ok"),
        size_bytes: 2,
      },
    })
    expect(errors).toEqual([
      { path: "a.txt", message: expect.stringContaining("LOCAL_PATH_CASE_CONFLICT") },
      { path: "A.txt", message: expect.stringContaining("LOCAL_PATH_CASE_CONFLICT") },
    ])
  })
  it("reuses the cached hash when mtime and size are unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-cache-"))
    await writeFile(join(root, "notes.txt"), "hello")
    const { lstat } = await import("node:fs/promises")
    const stats = await lstat(join(root, "notes.txt"))

    const files = await scanDriveFiles(root, {
      cache: {
        "notes.txt": { mtime_ms: stats.mtimeMs, size_bytes: stats.size, sha256: "cached-sha" },
      },
    })

    expect(files["notes.txt"]).toEqual({ sha256: "cached-sha", size_bytes: stats.size })
  })

  it("rehashes when mtime or size differ from the cache and reports fresh cache entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-cache-miss-"))
    await writeFile(join(root, "notes.txt"), "hello")
    const updates: Array<{ path: string; sha256: string }> = []

    const files = await scanDriveFiles(root, {
      cache: {
        "notes.txt": { mtime_ms: 1, size_bytes: 5, sha256: "stale-sha" },
      },
      onCacheUpdate: (path, entry) => updates.push({ path, sha256: entry.sha256 }),
    })

    expect(files["notes.txt"]).toEqual({ sha256: sha256("hello"), size_bytes: 5 })
    expect(updates).toEqual([{ path: "notes.txt", sha256: sha256("hello") }])
  })

  it("reports and skips a file that disappears between readdir and lstat", async () => {
    const errors: Array<{ path: string; code?: string }> = []
    const mockedScanDriveFiles = await importScannerWithMockFiles(
      { "gone.txt": "gone", "ok.txt": "ok" },
      {
        lstatError: (path) => (path.endsWith("gone.txt") ? errnoError("ENOENT") : undefined),
      },
    )

    const files = await mockedScanDriveFiles("/mock", {
      onPathError: (path, error) => {
        errors.push({ path, code: (error as NodeJS.ErrnoException).code })
      },
    })

    expect(files).toEqual({ "ok.txt": { sha256: sha256("ok"), size_bytes: 2 } })
    expect(errors).toEqual([{ path: "gone.txt", code: "ENOENT" }])
  })

  it("reports and skips a locked file during hashing", async () => {
    const errors: Array<{ path: string; code?: string }> = []
    const mockedScanDriveFiles = await importScannerWithMockFiles(
      { "locked.txt": "locked", "ok.txt": "ok" },
      {
        openError: (path) => (path.endsWith("locked.txt") ? errnoError("EBUSY") : undefined),
      },
    )

    const files = await mockedScanDriveFiles("/mock", {
      onPathError: (path, error) => {
        errors.push({ path, code: (error as NodeJS.ErrnoException).code })
      },
    })

    expect(files).toEqual({ "ok.txt": { sha256: sha256("ok"), size_bytes: 2 } })
    expect(errors).toEqual([{ path: "locked.txt", code: "EBUSY" }])
  })

  it("reports and skips a directory that disappears mid-walk", async () => {
    const errors: Array<{ path: string; code?: string }> = []
    const mockedScanDriveFiles = await importScannerWithMockFiles(
      { "ok.txt": "ok" },
      {
        extraDirs: ["renamed-away"],
        readdirError: (path) => (path.endsWith("renamed-away") ? errnoError("ENOENT") : undefined),
      },
    )

    const files = await mockedScanDriveFiles("/mock", {
      onPathError: (path, error) => {
        errors.push({ path, code: (error as NodeJS.ErrnoException).code })
      },
    })

    expect(files).toEqual({ "ok.txt": { sha256: sha256("ok"), size_bytes: 2 } })
    expect(errors).toEqual([{ path: "renamed-away", code: "ENOENT" }])
  })

  it("still fails the scan when the root itself cannot be read", async () => {
    const mockedScanDriveFiles = await importScannerWithMockFiles(
      {},
      {
        readdirError: () => errnoError("ENOENT"),
      },
    )

    await expect(mockedScanDriveFiles("/mock", { onPathError: () => undefined })).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rethrows unexpected fs error codes even with a handler", async () => {
    const mockedScanDriveFiles = await importScannerWithMockFiles(
      { "weird.txt": "weird" },
      {
        lstatError: (path) => (path.endsWith("weird.txt") ? errnoError("EIO") : undefined),
      },
    )

    await expect(mockedScanDriveFiles("/mock", { onPathError: () => undefined })).rejects.toMatchObject({ code: "EIO" })
  })
})

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: mock fs error`) as NodeJS.ErrnoException
  error.code = code
  return error
}

interface MockFsFailures {
  lstatError?: (path: string) => Error | undefined
  openError?: (path: string) => Error | undefined
  readdirError?: (path: string) => Error | undefined
  extraDirs?: string[]
}

async function importScannerWithMockFiles(files: Record<string, string>, failures: MockFsFailures = {}): Promise<typeof scanDriveFiles> {
  vi.resetModules()
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>()
    return {
      ...actual,
      readdir: vi.fn(async (path: string) => {
        const failure = failures.readdirError?.(String(path))
        if (failure) throw failure
        if (basename(String(path)) !== "mock") return []
        return [
          ...Object.keys(files).map((name) => ({ name })),
          ...(failures.extraDirs ?? []).map((name) => ({ name, isDir: true })),
        ]
      }),
      lstat: vi.fn(async (path: string) => {
        const failure = failures.lstatError?.(String(path))
        if (failure) throw failure
        const isDir = (failures.extraDirs ?? []).includes(basename(String(path)))
        return fakeStats(isDir)
      }),
      open: vi.fn(async (path: string) => {
        const failure = failures.openError?.(String(path))
        if (failure) throw failure
        const name = basename(path)
        const content = files[name]
        if (content === undefined) throw new Error(`unexpected mock file: ${path}`)
        return {
          stat: async () => fakeStats(),
          createReadStream: () => Readable.from([Buffer.from(content)]),
          close: async () => undefined,
        }
      }),
    }
  })
  const imported = await import("../../../src/handwritten/commands/drive/scanner.js")
  return imported.scanDriveFiles
}

function fakeStats(isDirectory = false) {
  return {
    isSymbolicLink: () => false,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    ino: 1,
    dev: 1,
  }
}

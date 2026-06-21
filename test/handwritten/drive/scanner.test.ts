import { createHash } from "node:crypto"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
})

async function importScannerWithMockFiles(files: Record<string, string>): Promise<typeof scanDriveFiles> {
  vi.resetModules()
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>()
    return {
      ...actual,
      readdir: vi.fn(async () =>
        Object.keys(files).map((name) => ({
          name,
        })),
      ),
      lstat: vi.fn(async () => fakeStats()),
      open: vi.fn(async (path: string) => {
        const name = path.split("/").at(-1) ?? ""
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

function fakeStats() {
  return {
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
    ino: 1,
    dev: 1,
  }
}

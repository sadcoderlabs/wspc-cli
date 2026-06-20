import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { scanDriveFiles } from "../../../src/handwritten/commands/drive/scanner.js"

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

describe("drive scanner", () => {
  it("includes dotfiles and nested files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-"))
    await mkdir(join(root, "notes"), { recursive: true })
    await mkdir(join(root, "notes", "nested"), { recursive: true })

    await writeFile(join(root, ".secret"), "hidden")
    await writeFile(join(root, "notes", "today.md"), "today")
    await writeFile(join(root, "notes", "nested", "hello.txt"), "hello")

    const files = await scanDriveFiles(root)

    expect(Object.fromEntries(files.entries())).toEqual({
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

  it("excludes .wspc-drive at root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-exclude-"))
    await mkdir(join(root, ".wspc-drive"), { recursive: true })
    await writeFile(join(root, ".wspc-drive", "state.json"), '{"schema_version":1}')
    await writeFile(join(root, "keep.txt"), "keep")

    const files = await scanDriveFiles(root)

    expect(Object.fromEntries(files.entries())).toEqual({
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

    expect(Object.fromEntries(files.entries())).toEqual({
      "target.txt": {
        sha256: sha256("target"),
        size_bytes: 6,
      },
    })
    expect(files.has("linked.txt")).toBe(false)
  })

  it("skips non-regular entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-special-"))
    await mkdir(join(root, "dir"), { recursive: true })
    await writeFile(join(root, "dir", "a.txt"), "in-dir")

    const files = await scanDriveFiles(root)
    const names = [...files.keys()]
    expect(names).toEqual(["dir/a.txt"])
  })
})

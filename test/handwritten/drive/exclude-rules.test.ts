import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadDriveExcludeRules } from "../../../src/handwritten/commands/drive/exclude-rules.js"

describe("drive exclude rules", () => {
  it("treats a missing ignore file as no rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-ignore-"))

    const rules = await loadDriveExcludeRules(root)

    expect(rules.size).toBe(0)
    expect(rules.matches("notes.md")).toBe(false)
  })

  it("parses exact and directory rules with case-sensitive matching", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-ignore-"))
    await mkdir(join(root, ".wspc-drive"))
    await writeFile(
      join(root, ".wspc-drive", "ignore"),
      "  # machine-local files\n\n.DS_Store\nnode_modules/\nnode_modules/\n",
    )

    const rules = await loadDriveExcludeRules(root)

    expect(rules.size).toBe(2)
    expect(rules.matches(".DS_Store")).toBe(true)
    expect(rules.matches(".DS_Store/child")).toBe(false)
    expect(rules.matches("node_modules")).toBe(false)
    expect(rules.matches("node_modules", "directory")).toBe(true)
    expect(rules.matches("node_modules/pkg/index.js")).toBe(true)
    expect(rules.matches("Node_modules/pkg/index.js")).toBe(false)
  })

  it.each([
    "/absolute",
    "../outside",
    "folder/./file",
    "folder\\file",
    "folder//file",
    "bad\u0001file",
    "a".repeat(256),
    Array.from({ length: 7 }, () => "a".repeat(170)).join("/"),
    "/",
  ])("reports the ignore file and line number for invalid rule %j", async (rule) => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-ignore-"))
    await mkdir(join(root, ".wspc-drive"))
    await writeFile(join(root, ".wspc-drive", "ignore"), `# comment\n\n${rule}\n`)

    await expect(loadDriveExcludeRules(root)).rejects.toThrow(/\.wspc-drive[/\\]ignore:3: invalid drive path/)
  })
})

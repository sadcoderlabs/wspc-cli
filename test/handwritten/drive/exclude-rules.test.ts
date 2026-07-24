import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  loadDriveExcludeRules,
  parseDriveExcludeRules,
} from "../../../src/handwritten/commands/drive/exclude-rules.js"

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

  it("matches file globs with native case-sensitive and dotfile semantics", () => {
    const rules = parseDriveExcludeRules("*.log\n**/*.txt\n.*\nfile[[]1].json\n")

    expect(rules.size).toBe(4)
    expect(rules.matches("app.log")).toBe(true)
    expect(rules.matches("logs/app.log")).toBe(false)
    expect(rules.matches("readme.txt")).toBe(true)
    expect(rules.matches("docs/readme.txt")).toBe(true)
    expect(rules.matches(".env")).toBe(true)
    expect(rules.matches("config/.env")).toBe(false)
    expect(rules.matches("file[1].json")).toBe(true)
    expect(rules.matches("FILE[1].json")).toBe(false)
  })

  it("matches directory globs and all descendants through matching ancestors", () => {
    const rules = parseDriveExcludeRules("packages/*/dist/\n**/cache/\n")

    expect(rules.matches("packages/web/dist")).toBe(false)
    expect(rules.matches("packages/web/dist", "directory")).toBe(true)
    expect(rules.matches("packages/web/dist/app.js")).toBe(true)
    expect(rules.matches("packages/web/dist/assets", "directory")).toBe(true)
    expect(rules.matches("packages/web/src/app.js")).toBe(false)
    expect(rules.matches("apps/cache", "directory")).toBe(true)
    expect(rules.matches("apps/cache/data/item.json")).toBe(true)
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

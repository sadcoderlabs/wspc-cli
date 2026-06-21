import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { Command } from "commander"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { initDriveState } from "../../../src/handwritten/commands/drive/state.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"
import { render } from "../../../src/handwritten/output/render.js"

const getLibraryMock = vi.fn()

vi.mock("../../../src/handwritten/commands/drive/api.js", () => ({
  createDriveApi: vi.fn(async () => ({
    getLibrary: getLibraryMock,
  })),
}))

vi.mock("../../../src/handwritten/output/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/handwritten/output/render.js")>()
  return {
    ...actual,
    render: vi.fn(),
  }
})

import { driveBindCommand } from "../../../src/handwritten/commands/drive/bind.js"

describe("drive bind", () => {
  beforeEach(() => {
    process.exitCode = undefined
    vi.clearAllMocks()
    getLibraryMock.mockResolvedValue({ id: "lib_a", name: "Docs" })
  })

  it("validates library and writes state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-bind-"))
    const cmd = driveBindCommand()

    await cmd.parseAsync(["node", "bind", "--library", "lib_a", root])

    const state = JSON.parse(await readFile(join(root, ".wspc-drive", "state.json"), "utf8"))
    expect(state.library_id).toBe("lib_a")
    expect(createDriveApi).toHaveBeenCalledOnce()
    expect(getLibraryMock).toHaveBeenCalledWith("lib_a")
    expect(render).toHaveBeenCalledWith(
      { kind: "drive_bind", display: { shape: "object" } },
      expect.objectContaining({
        root,
        library_id: "lib_a",
        library_name: "Docs",
      }),
    )
  })

  it("rejects mismatched existing binding and does not rewrite state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-bind-mismatch-"))
    await initDriveState(root, "lib_existing")
    const before = await readFile(join(root, ".wspc-drive", "state.json"), "utf8")

    const cmd = driveBindCommand()
    await expect(cmd.parseAsync(["node", "bind", "--library", "lib_a", root])).rejects.toThrow(
      /already bound to lib_existing/,
    )

    const after = await readFile(join(root, ".wspc-drive", "state.json"), "utf8")
    expect(after).toBe(before)
    expect(getLibraryMock).toHaveBeenCalledWith("lib_a")
  })

  it("does not write state when validation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-bind-fail-"))
    getLibraryMock.mockRejectedValue(new Error("HTTP 404: not found"))

    const cmd = driveBindCommand()
    await expect(cmd.parseAsync(["node", "bind", "--library", "lib_missing", root])).rejects.toThrow(
      /HTTP 404/,
    )

    await expect(readFile(join(root, ".wspc-drive", "state.json"), "utf8")).rejects.toThrow()
  })

  it("rejects nonexistent local folder before validating library", async () => {
    const parent = await mkdtemp(join(tmpdir(), "wspc-drive-bind-missing-"))
    const root = join(parent, "notse")

    const cmd = driveBindCommand()
    await expect(cmd.parseAsync(["node", "bind", "--library", "lib_a", root])).rejects.toThrow(
      /local folder does not exist/,
    )

    expect(getLibraryMock).not.toHaveBeenCalled()
    await expect(readFile(join(root, ".wspc-drive", "state.json"), "utf8")).rejects.toThrow()
  })

  it("rejects file paths before validating library", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-bind-file-"))
    const file = join(root, "notes.txt")
    await writeFile(file, "hello")

    const cmd = driveBindCommand()
    await expect(cmd.parseAsync(["node", "bind", "--library", "lib_a", file])).rejects.toThrow(
      /local path is not a folder/,
    )

    expect(getLibraryMock).not.toHaveBeenCalled()
  })

  it("mounts bind under source CLI drive help", () => {
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "drive", "--help"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: undefined, TERM: "xterm-256color" },
    })

    expect(res.status).toBe(0)
    expect(res.stdout).toContain("bind")
    expect(res.stdout).toContain("Bind a local folder to an existing Drive library")
    expect(res.stdout).toContain("watch")
    expect(res.stdout).toContain("Watch a bound Drive folder and sync local changes")
  })

  it("mounts bind onto an existing drive command tree", async () => {
    const { mountDriveCommands } = await import("../../../src/cli.js")
    const program = new Command("wspc")
    const drive = new Command("drive").description("Generated Drive commands")
    drive.command("generated")
    program.addCommand(drive)

    mountDriveCommands(program)

    const driveRoots = program.commands.filter((cmd) => cmd.name() === "drive")
    expect(driveRoots).toHaveLength(1)
    expect(driveRoots[0]!.commands.map((cmd) => cmd.name())).toEqual(["generated", "bind", "sync", "watch"])
  })

  it("does not duplicate a generated drive bind command", async () => {
    const { mountDriveCommands } = await import("../../../src/cli.js")
    const program = new Command("wspc")
    const drive = new Command("drive").description("Generated Drive commands")
    drive.command("bind")
    program.addCommand(drive)

    mountDriveCommands(program)

    expect(drive.commands.filter((cmd) => cmd.name() === "bind")).toHaveLength(1)
  })

  it("does not duplicate a generated drive watch command", async () => {
    const { mountDriveCommands } = await import("../../../src/cli.js")
    const program = new Command("wspc")
    const drive = new Command("drive").description("Generated Drive commands")
    drive.command("watch")
    program.addCommand(drive)

    mountDriveCommands(program)

    expect(drive.commands.filter((cmd) => cmd.name() === "watch")).toHaveLength(1)
  })

  it("adds sync once under a generated drive sync command without duplicating the sync root", async () => {
    const { mountDriveCommands } = await import("../../../src/cli.js")
    const program = new Command("wspc")
    const drive = new Command("drive").description("Generated Drive commands")
    const sync = new Command("sync").description("Generated sync commands")
    sync.command("other")
    drive.addCommand(sync)
    program.addCommand(drive)

    mountDriveCommands(program)

    expect(drive.commands.filter((cmd) => cmd.name() === "sync")).toHaveLength(1)
    expect(drive.commands.map((cmd) => cmd.name())).toContain("bind")
    expect(drive.commands.map((cmd) => cmd.name())).toContain("watch")
    expect(sync.commands.map((cmd) => cmd.name())).toEqual(["other", "once"])
  })

  it("detects symlinked CLI entrypoints", async () => {
    const { isCliEntrypoint } = await import("../../../src/cli.js")
    const dir = await mkdtemp(join(tmpdir(), "wspc-drive-bind-main-"))
    const target = join(process.cwd(), "src", "cli.ts")
    const link = join(dir, "wspc")
    await symlink(target, link)

    expect(isCliEntrypoint(["node", link], pathToFileURL(target).href)).toBe(true)
    expect(isCliEntrypoint(["node", join(dir, "other")], pathToFileURL(target).href)).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initDriveState } from "../../../src/handwritten/commands/drive/state.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"
import { render } from "../../../src/handwritten/output/render.js"

const getLibraryMock = vi.fn()

vi.mock("../../../src/handwritten/commands/drive/api.js", () => ({
  createDriveApi: vi.fn(async () => ({
    getLibrary: getLibraryMock,
  })),
}))

vi.mock("../../../src/handwritten/output/render.js", () => ({
  render: vi.fn(),
}))

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

  it("mounts bind under source CLI drive help", () => {
    const res = spawnSync("node", ["--import", "tsx", "src/cli.ts", "drive", "--help"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: undefined, TERM: "xterm-256color" },
    })

    expect(res.status).toBe(0)
    expect(res.stdout).toContain("bind")
    expect(res.stdout).toContain("Bind a local folder to an existing Drive library")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/generated/sdk/index.js", () => ({
  driveLibraryDelete: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  driveLibraryUpdate: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  driveFileDelete: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  driveSearch: vi.fn(async () => ({
    data: { results: [] },
    response: { ok: true, status: 200 },
  })),
  driveWorkspaceSearch: vi.fn(async () => ({
    data: { results: [] },
    response: { ok: true, status: 200 },
  })),
}))

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: vi.fn(async () => ({ _rawClient: {} })),
}))

vi.mock("../../src/handwritten/output/render.js", () => ({
  render: vi.fn(),
}))

async function loadCommands() {
  vi.resetModules()
  const libraryDelete = await import(
    "../../src/generated/cli/drive/library/rm.js"
  )
  const libraryUpdate = await import(
    "../../src/generated/cli/drive/library/update.js"
  )
  const fileDelete = await import("../../src/generated/cli/drive/file/rm.js")
  const search = await import("../../src/generated/cli/drive/search.js")
  const sdk = await import("../../src/generated/sdk/index.js")
  const { render } = await import("../../src/handwritten/output/render.js")
  return {
    driveSearchCommand: search.driveSearchCommand,
    driveSearch: sdk.driveSearch as ReturnType<typeof vi.fn>,
    driveWorkspaceSearch: sdk.driveWorkspaceSearch as ReturnType<typeof vi.fn>,
    render: render as ReturnType<typeof vi.fn>,
    driveLibraryDeleteCommand: libraryDelete.driveLibraryDeleteCommand,
    driveLibraryUpdateCommand: libraryUpdate.driveLibraryUpdateCommand,
    driveFileDeleteCommand: fileDelete.driveFileDeleteCommand,
    driveLibraryDelete: sdk.driveLibraryDelete as ReturnType<typeof vi.fn>,
    driveLibraryUpdate: sdk.driveLibraryUpdate as ReturnType<typeof vi.fn>,
    driveFileDelete: sdk.driveFileDelete as ReturnType<typeof vi.fn>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("wspc drive generated numeric options", () => {
  it("passes library rm --expected-version as a number", async () => {
    const { driveLibraryDeleteCommand, driveLibraryDelete } =
      await loadCommands()

    await driveLibraryDeleteCommand.parseAsync([
      "node",
      "rm",
      "lib_123",
      "--expected-version",
      "1003",
    ])

    expect(driveLibraryDelete.mock.calls[0]?.[0]?.body).toEqual({
      expected_version: 1003,
    })
  })

  it("passes library update --expected-version as a number", async () => {
    const { driveLibraryUpdateCommand, driveLibraryUpdate } =
      await loadCommands()

    await driveLibraryUpdateCommand.parseAsync([
      "node",
      "update",
      "lib_123",
      "--name",
      "renamed",
      "--expected-version",
      "1003",
    ])

    expect(driveLibraryUpdate.mock.calls[0]?.[0]?.body).toEqual({
      name: "renamed",
      expected_version: 1003,
    })
  })

  it("passes file rm --expected-entry-version as a number", async () => {
    const { driveFileDeleteCommand, driveFileDelete } = await loadCommands()

    await driveFileDeleteCommand.parseAsync([
      "node",
      "rm",
      "lib_123",
      "notes/example.md",
      "--expected-entry-version",
      "7",
    ])

    expect(driveFileDelete.mock.calls[0]?.[0]?.body).toEqual({
      path: "notes/example.md",
      expected_entry_version: 7,
    })
  })
})

describe("wspc drive search scope", () => {
  it("searches the Workspace when the library id is omitted", async () => {
    const { driveSearchCommand, driveSearch, driveWorkspaceSearch, render } =
      await loadCommands()

    await driveSearchCommand.parseAsync(["node", "search", "--query", "日本旅遊"])

    expect(driveSearch).toHaveBeenCalledTimes(0)
    expect(driveWorkspaceSearch).toHaveBeenCalledTimes(1)
    const input = driveWorkspaceSearch.mock.calls[0]?.[0]
    expect(input.path).toBeUndefined()
    expect(input.query.query).toBe("日本旅遊")
    expect(input.query.path_prefix).toBeUndefined()
    const context = render.mock.calls[0]?.[0]
    expect(context.kind).toBe("drive_workspace_search")
    expect(context.display.columns).toContain("library_id")
  })

  it("searches one library with --path-prefix when the id is given", async () => {
    const { driveSearchCommand, driveSearch, driveWorkspaceSearch, render } =
      await loadCommands()

    await driveSearchCommand.parseAsync([
      "node",
      "search",
      "lib_123",
      "--query",
      "日本旅遊",
      "--path-prefix",
      "travel/",
    ])

    expect(driveWorkspaceSearch).toHaveBeenCalledTimes(0)
    expect(driveSearch).toHaveBeenCalledTimes(1)
    const input = driveSearch.mock.calls[0]?.[0]
    expect(input.path.id).toBe("lib_123")
    expect(input.query.path_prefix).toBe("travel/")
    const context = render.mock.calls[0]?.[0]
    expect(context.kind).toBe("drive_search")
    expect(context.display.columns).toEqual(["path", "snippet"])
  })

  it("passes --path-prefix and --cursor through in Workspace scope", async () => {
    const { driveSearchCommand, driveWorkspaceSearch } = await loadCommands()

    await driveSearchCommand.parseAsync([
      "node",
      "search",
      "--query",
      "日本旅遊",
      "--path-prefix",
      "travel/",
      "--cursor",
      "c2",
    ])

    const query = driveWorkspaceSearch.mock.calls[0]?.[0]?.query
    expect(query.path_prefix).toBe("travel/")
    expect(query.cursor).toBe("c2")
  })

  it("documents the optional id and --path-prefix in --help", async () => {
    const { driveSearchCommand } = await loadCommands()

    const help = driveSearchCommand.helpInformation()

    expect(help).toContain("[id]")
    expect(help).toContain("--path-prefix <value>")
    expect(help).toMatch(/--cursor <value>[\s\S]*path_prefix/)
  })
})

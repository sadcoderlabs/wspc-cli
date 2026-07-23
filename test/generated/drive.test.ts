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
  const sdk = await import("../../src/generated/sdk/index.js")
  return {
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

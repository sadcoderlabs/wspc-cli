import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadSdkClient: vi.fn(),
  render: vi.fn(),
}))

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: mocks.loadSdkClient,
}))
vi.mock("../../src/handwritten/output/render.js", () => ({ render: mocks.render }))

import { runSdkCommand } from "../../src/handwritten/commands/sdk-result.js"

describe("runSdkCommand", () => {
  beforeEach(() => {
    mocks.loadSdkClient.mockReset()
    mocks.render.mockReset()
    process.exitCode = undefined
  })

  it("loads the raw SDK client and renders result.data", async () => {
    const rawClient = { raw: true }
    mocks.loadSdkClient.mockResolvedValue({ _rawClient: rawClient })

    const result = await runSdkCommand(
      { kind: "todo_get", display: { shape: "object" } },
      async (client) => {
        expect(client).toBe(rawClient)
        return { data: { id: "tod_1" }, response: { ok: true, status: 200 } }
      },
    )

    expect(result?.data).toEqual({ id: "tod_1" })
    expect(mocks.render).toHaveBeenCalledWith(
      { kind: "todo_get", display: { shape: "object" } },
      { id: "tod_1" },
    )
  })

  it("renders selected success data", async () => {
    mocks.loadSdkClient.mockResolvedValue({ _rawClient: {} })

    await runSdkCommand(
      { kind: "email_send", display: { shape: "object" } },
      async () => ({
        data: { email: { id: "eml_1" }, idempotent_replay: false },
        response: { ok: true, status: 200 },
      }),
      (result) => result.data?.email,
    )

    expect(mocks.render).toHaveBeenCalledWith(
      { kind: "email_send", display: { shape: "object" } },
      { id: "eml_1" },
    )
  })

  it("prints current HTTP error format and sets exitCode", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    mocks.loadSdkClient.mockResolvedValue({ _rawClient: {} })

    const result = await runSdkCommand(
      { kind: "todo_get", display: { shape: "object" } },
      async () => ({ error: { message: "bad" }, response: { ok: false, status: 400 } }),
    )

    expect(result).toBeUndefined()
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith("HTTP 400: {\n  \"message\": \"bad\"\n}\n")
    expect(mocks.render).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it("renders undefined when selected data is undefined", async () => {
    mocks.loadSdkClient.mockResolvedValue({ _rawClient: {} })

    await runSdkCommand(
      { kind: "empty", display: { shape: "object" } },
      async () => ({ data: { value: 1 }, response: { ok: true, status: 200 } }),
      () => undefined,
    )

    expect(mocks.render).toHaveBeenCalledWith({ kind: "empty", display: { shape: "object" } }, undefined)
  })
})

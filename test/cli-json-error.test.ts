import { afterEach, describe, expect, it, vi } from "vitest"

const todoCreateMock = vi.fn()

vi.mock("../src/generated/sdk/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/generated/sdk/index.js")>()
  return {
    ...actual,
    todoCreate: (...args: unknown[]) => todoCreateMock(...args),
  }
})

import { dispatch } from "../src/cli.js"

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
  todoCreateMock.mockReset()
})

describe("CLI JSON option errors", () => {
  it("reports malformed JSON through root dispatch without calling the SDK or process.exit", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("forced process exit")
    })
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    await dispatch(["node", "wspc", "todo", "add", "Title", "--custom-fields", "{"])

    expect(todoCreateMock).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledOnce()
    expect(stderr).toHaveBeenCalledWith("error: Invalid JSON for --custom-fields: {\n")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const todoUpdateMock = vi.fn()
const renderMock = vi.fn()

vi.mock("../src/generated/sdk/index.js", () => ({
  todoUpdate: (...args: unknown[]) => todoUpdateMock(...args),
}))
vi.mock("../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: { name: "raw" } }),
}))
vi.mock("../src/handwritten/output/render.js", () => ({
  render: (...args: unknown[]) => renderMock(...args),
}))

import { todoDoneCommand } from "../src/handwritten/commands/todo-done.js"

beforeEach(() => {
  todoUpdateMock.mockReset()
  renderMock.mockReset()
  process.exitCode = undefined
  todoUpdateMock.mockResolvedValue({
    data: { id: "tod_1", status: "done" },
    response: { ok: true, status: 200 },
  })
})

describe("wspc todo done", () => {
  it("marks the todo done and renders the updated todo", async () => {
    await todoDoneCommand.parseAsync(["node", "done", "tod_1"])

    expect(todoUpdateMock).toHaveBeenCalledWith({
      client: { name: "raw" },
      path: { id: "tod_1" },
      body: { status: "done" },
    })
    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "todo_update" }),
      { id: "tod_1", status: "done" },
    )
  })

  it("reports HTTP failures without rendering", async () => {
    todoUpdateMock.mockResolvedValue({
      error: { code: "VALIDATION_ERROR" },
      response: { ok: false, status: 400 },
    })
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      await todoDoneCommand.parseAsync(["node", "done", "tod_1"])

      expect(process.exitCode).toBe(1)
      expect(renderMock).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledWith(
        'HTTP 400: {\n  "code": "VALIDATION_ERROR"\n}\n',
      )
    } finally {
      stderr.mockRestore()
    }
  })
})

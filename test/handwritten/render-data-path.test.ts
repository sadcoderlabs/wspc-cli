import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerRenderer, render } from "../../src/handwritten/output/render.js"

// Force pretty mode so we exercise the drill, not the JSON early-return.
const originalEnv = process.env.WSPC_OUTPUT

beforeEach(() => {
  process.env.WSPC_OUTPUT = "pretty"
})

afterEach(() => {
  process.env.WSPC_OUTPUT = originalEnv
})

describe("render: dataPath drill", () => {
  it("passes the nested object to a specific renderer when dataPath is set", () => {
    const received: unknown[] = []
    registerRenderer("test_data_path_a", (data) => {
      received.push(data)
    })
    render(
      {
        kind: "test_data_path_a",
        display: { shape: "object", dataPath: "email" },
      },
      { email: { id: "eml_X", subject: "hello" }, attachments: [] },
    )
    expect(received[0]).toEqual({ id: "eml_X", subject: "hello" })
  })

  it("passes data unchanged when dataPath is omitted", () => {
    const received: unknown[] = []
    registerRenderer("test_data_path_b", (data) => {
      received.push(data)
    })
    render(
      { kind: "test_data_path_b", display: { shape: "object" } },
      { id: "out_X" },
    )
    expect(received[0]).toEqual({ id: "out_X" })
  })

  it("falls back to original data if dataPath key is missing", () => {
    const received: unknown[] = []
    registerRenderer("test_data_path_c", (data) => {
      received.push(data)
    })
    render(
      {
        kind: "test_data_path_c",
        display: { shape: "object", dataPath: "missing_key" },
      },
      { id: "x" },
    )
    expect(received[0]).toEqual({ id: "x" })
  })

  it("JSON mode prints the full wrapper, ignoring dataPath", () => {
    process.env.WSPC_OUTPUT = "json"
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    render(
      {
        kind: "test_data_path_d",
        display: { shape: "object", dataPath: "email" },
      },
      { email: { id: "eml_X" }, attachments: [] },
    )
    const printed = writeSpy.mock.calls[0]?.[0] as string
    expect(JSON.parse(printed)).toEqual({ email: { id: "eml_X" }, attachments: [] })
    writeSpy.mockRestore()
  })
})

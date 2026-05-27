import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render } from "../src/handwritten/output/render.js"
import type { XCliDisplay } from "../src/handwritten/output/types.js"

/**
 * Renderer behaviour tests. The renderer writes to `process.stdout` and reads
 * `process.stdout.isTTY` + `WSPC_OUTPUT` to decide pretty vs JSON, so each
 * test pins the relevant ambient state and captures writes via a spy.
 */
function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    })
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

describe("render", () => {
  const origTTY = process.stdout.isTTY
  const origEnv = process.env.WSPC_OUTPUT
  let cap: ReturnType<typeof captureStdout>

  beforeEach(() => {
    // Default to TTY so generic renderer runs; individual tests override.
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    delete process.env.WSPC_OUTPUT
    cap = captureStdout()
  })

  afterEach(() => {
    cap.restore()
    Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true })
    if (origEnv === undefined) delete process.env.WSPC_OUTPUT
    else process.env.WSPC_OUTPUT = origEnv
  })

  it("emits JSON when WSPC_OUTPUT=json", () => {
    process.env.WSPC_OUTPUT = "json"
    render({ kind: "todo.list" }, { todos: [{ id: "tod_1", title: "x" }] })
    expect(JSON.parse(cap.output().trim())).toEqual({
      todos: [{ id: "tod_1", title: "x" }],
    })
  })

  it("emits JSON when output is being piped (non-TTY)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    render({ kind: "todo.list" }, { todos: [{ id: "tod_1" }] })
    expect(JSON.parse(cap.output().trim())).toEqual({ todos: [{ id: "tod_1" }] })
  })

  it("renders a list with display hints into a table", () => {
    const display: XCliDisplay = {
      shape: "list",
      columns: ["id", "title"],
      format: { id: "id-short", title: "truncate" },
    }
    render(
      { kind: "todo.list", display },
      {
        todos: [
          { id: "tod_01HW3K4N9V5G6Z8C2Q7B1Y0M3F", title: "Buy milk" },
          { id: "tod_01HW3K4N9V5G6Z8C2Q7B1Y0M4G", title: "Submit expenses" },
        ],
      },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("ID")
    expect(out).toContain("TITLE")
    expect(out).toContain("tod_01HW3K4N")
    expect(out).toContain("Buy milk")
    expect(out).toContain("Submit expenses")
  })

  it("prints emptyMessage for empty lists", () => {
    render(
      { kind: "todo.list", display: { shape: "list", emptyMessage: "no todos" } },
      { todos: [] },
    )
    expect(stripAnsi(cap.output())).toContain("no todos")
  })

  it("auto-detects list shape without hints", () => {
    render({ kind: "unknown.list" }, { items: [{ id: "a" }, { id: "b" }] })
    expect(stripAnsi(cap.output())).toMatch(/ID/)
  })

  it("renders objects as key-value with envelope unwrap", () => {
    render(
      { kind: "todo.get", display: { shape: "object" } },
      { todo: { id: "tod_1", title: "x", status: "open" } },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("id")
    expect(out).toContain("tod_1")
    expect(out).toContain("title")
    expect(out).toContain("x")
    expect(out).toContain("status")
  })

  it("falls back to JSON for objects with no scalar fields", () => {
    render(
      { kind: "weird.object", display: { shape: "object" } },
      { nested: { a: { b: 1 } } },
    )
    // Single-key unwrap leaves us with { a: { b: 1 } }; `a` is itself an
    // object, so there are no scalar fields → JSON fallback prints the
    // unwrapped object as-is.
    expect(cap.output().trim()).toBe(JSON.stringify({ a: { b: 1 } }, null, 2))
  })
})

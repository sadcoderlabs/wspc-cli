import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render } from "../src/handwritten/output/render.js"
import type { XCliDisplay } from "../src/handwritten/output/types.js"
import { captureStdout, stripAnsi } from "./helpers/stdout.js"

/**
 * Renderer behaviour tests. The renderer writes to `process.stdout` and reads
 * `process.stdout.isTTY` + `WSPC_OUTPUT` to decide pretty vs JSON, so each
 * test pins the relevant ambient state and captures writes via a spy.
 */
describe("render", () => {
  const origTTY = process.stdout.isTTY
  const origColumns = process.stdout.columns
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
    Object.defineProperty(process.stdout, "columns", { value: origColumns, configurable: true })
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

  it("keeps explicitly requested columns when an optional value is absent", () => {
    render(
      {
        kind: "event_occurrences",
        display: { shape: "list", columns: ["recurrence_id", "time_zone"] },
      },
      { occurrences: [{ recurrence_id: "2026-06-01" }] },
    )

    const out = stripAnsi(cap.output())
    expect(out).toContain("RECURRENCE_ID")
    expect(out).toContain("TIME_ZONE")
    expect(out).toContain("2026-06-01")
  })

  it("marks soft-deleted list rows without marking active rows", () => {
    render(
      { kind: "todo.list", display: { shape: "list", columns: ["id", "title"] } },
      {
        items: [
          { id: "a", title: "active" },
          { id: "b", title: "gone", deleted_at: 1748822400000 },
        ],
      },
    )
    const lines = stripAnsi(cap.output()).split("\n")
    const activeLine = lines.find((line) => line.includes("active"))
    const deletedLine = lines.find((line) => line.includes("gone"))

    expect(activeLine).toBeDefined()
    expect(activeLine).not.toContain("✕")
    expect(deletedLine).toContain("✕")
  })

  it("prints emptyMessage for empty lists", () => {
    render(
      { kind: "todo.list", display: { shape: "list", emptyMessage: "no todos" } },
      { todos: [] },
    )
    expect(stripAnsi(cap.output())).toContain("no todos")
  })

  it("does not throw for scalar list items", () => {
    expect(() => render({ kind: "weird.list", display: { shape: "list" } }, ["one", "two"])).not.toThrow()
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

  it("writes raw shape passthrough without JSON escaping (TTY)", () => {
    const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
    render({ kind: "event.ics", display: { shape: "raw" } }, ics)
    // No JSON quoting, no \r\n -> \\r\\n escaping; trailing newline preserved.
    expect(cap.output()).toBe(ics)
  })

  it("writes raw shape passthrough when piped (non-TTY)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"
    render({ kind: "event.ics", display: { shape: "raw" } }, ics)
    expect(cap.output()).toBe(ics)
  })

  it("raw shape appends a trailing newline when missing", () => {
    render({ kind: "event.ics", display: { shape: "raw" } }, "hello")
    expect(cap.output()).toBe("hello\n")
  })

  it("renders attendee array as indented sub-list under scalar fields", () => {
    render(
      { kind: "event.get", display: { shape: "object" } },
      {
        event: {
          id: "evt_1",
          title: "Standup",
          attendees: [
            { email: "alice@example.com", display_name: "Alice" },
            { email: "bob@example.com" },
          ],
        },
      },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("attendees")
    expect(out).toContain("2 items")
    expect(out).toContain("1. Alice <alice@example.com>")
    expect(out).toContain("2. <bob@example.com>")
  })

  it("caps long arrays with an overflow line", () => {
    const attendees = Array.from({ length: 12 }, (_, i) => ({
      email: `u${i}@x.com`,
    }))
    render(
      { kind: "event.get", display: { shape: "object" } },
      { event: { id: "evt_1", attendees } },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("12 items")
    expect(out).toContain("10. <u9@x.com>")
    expect(out).toContain("... and 2 more")
    expect(out).not.toContain("11. <u10@x.com>")
  })

  it("falls back to JSON for objects with no scalar fields", () => {
    render(
      { kind: "weird.object", display: { shape: "object" } },
      { nested: { a: { b: 1 } } },
    )
    // Single-key unwrap leaves us with { a: { b: 1 } }; `a` is itself an
    // object, so there are no scalar fields → JSON fallback prints the
    // unwrapped object as-is.
  })

  it("renders enum-badge format with enumColorMap correctly", () => {
    const display: XCliDisplay = {
      shape: "object",
      fields: ["status", "transport", "detail"],
      format: {
        status: "enum-badge",
        transport: "enum-badge",
        detail: "enum-badge",
      },
      enumColorMap: {
        status: {
          ok: { label: "✓ ok", color: "green" },
          telegram_4xx: { label: "✕ telegram_4xx", color: "red" },
          "*": { label: "✕ <value>", color: "red" },
          null: { label: "—", color: "dim" },
        },
        transport: {
          telegram: { label: "TG: <value>", color: "cyan" },
          "*": { label: "Other: <value>", color: "yellow" },
        },
        detail: {
          "*": { label: "Details: <value>", color: "gray" },
          null: { label: "No details", color: "dim" },
        },
      },
    }

    render(
      { kind: "push.status", display },
      {
        status: "ok",
        transport: "telegram",
        detail: null,
      },
    )

    const out = cap.output()
    const plain = stripAnsi(out)

    expect(plain).toContain("✓ ok")
    expect(plain).toContain("TG: telegram")
    expect(plain).toContain("No details")

    expect(out).toContain("\x1b[32m✓ ok\x1b[39m")
    expect(out).toContain("\x1b[36mTG: telegram\x1b[39m")
    expect(out).toContain("\x1b[2mNo details\x1b[22m")
  })

  it("handles unknown/wildcard and undefined values in enum-badge", () => {
    const display: XCliDisplay = {
      shape: "object",
      fields: ["status", "transport", "detail"],
      format: {
        status: "enum-badge",
        transport: "enum-badge",
        detail: "enum-badge",
      },
      enumColorMap: {
        status: {
          ok: { label: "✓ ok", color: "green" },
          "*": { label: "✕ <value>", color: "red" },
          null: { label: "—", color: "dim" },
        },
        transport: {
          "*": { label: "Other: <value>", color: "yellow" },
        },
        detail: {
          "*": { label: "Details: <value>", color: "gray" },
          null: { label: "No details", color: "dim" },
        },
      },
    }

    render(
      { kind: "push.status", display },
      {
        status: "unknown_value",
        transport: "discord",
        detail: undefined,
      },
    )

    const out = cap.output()
    const plain = stripAnsi(out)

    expect(plain).toContain("✕ unknown_value")
    expect(plain).toContain("Other: discord")
    expect(plain).toContain("No details")

    expect(out).toContain("\x1b[31m✕ unknown_value\x1b[39m")
    expect(out).toContain("\x1b[33mOther: discord\x1b[39m")
    expect(out).toContain("\x1b[2mNo details\x1b[22m")
  })

  it("prints a yellow warning block in pretty mode when secretField is present", () => {
    const data = {
      id: "key_abcd1234",
      label: "openclaw-tokyo",
      api_key: "wspc_live_xxxxxxxxxxxxxxxxxxxxxxx",
      created_at: 1748736000000,
    }
    const display: XCliDisplay = {
      shape: "object",
      fields: ["id", "label", "api_key", "created_at"],
      secretField: "api_key",
    }
    render({ kind: "auth.keys.create", display }, data)
    const out = cap.output()
    const plain = stripAnsi(out)
    expect(plain).toContain("api_key")
    expect(plain).toContain("wspc_live_xxxxxxxxxxxxxxxxxxxxxxx")
    expect(plain).toContain("⚠  This is the only time you'll see this key. Save it now.")
    expect(plain).toContain("wspc env add <name> --api-key wspc_live_xxxxxxxxxxxxxxxxxxxxxxx")
    expect(out).toContain("\x1b[33m⚠  This is the only time you'll see this key. Save it now.\x1b[39m")
  })

  it("does not print the warning block in JSON mode when secretField is present", () => {
    process.env.WSPC_OUTPUT = "json"
    const data = {
      id: "key_abcd1234",
      label: "openclaw-tokyo",
      api_key: "wspc_live_xxxxxxxxxxxxxxxxxxxxxxx",
      created_at: 1748736000000,
    }
    const display: XCliDisplay = {
      shape: "object",
      fields: ["id", "label", "api_key", "created_at"],
      secretField: "api_key",
    }
    render({ kind: "auth.keys.create", display }, data)
    const out = stripAnsi(cap.output())
    expect(out).not.toContain("This is the only time you'll see this key")
    expect(out).not.toContain("wspc env add")
  })

  it("renders a long description as an indented block, not truncated", () => {
    Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true })
    const longDesc = "x".repeat(120)
    render(
      { kind: "todo_get", display: { shape: "object", format: { description: "truncate" } } },
      { id: "tod_1", title: "short", description: longDesc },
    )
    const out = stripAnsi(cap.output())
    expect(out).not.toContain("…")
    expect(out.replace(/\s/g, "")).toContain("x".repeat(120))
    expect(out).toMatch(/\n {2}description\n {4}x/)
  })

  it("keeps short scalar fields as aligned two-column rows", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    render(
      { kind: "todo_get", display: { shape: "object", format: { title: "truncate" } } },
      { id: "tod_1", title: "Buy milk" },
    )
    const out = stripAnsi(cap.output())
    expect(out).toMatch(/ {2}title {2,}Buy milk/)
  })

  it("keeps Todo Calendar Dates raw while formatting Instant fields relatively", () => {
    const createdAt = Date.now() - 2 * 60 * 60 * 1000
    render(
      {
        kind: "todo.get",
        display: {
          shape: "object",
          fields: ["due_at", "created_at"],
          format: { due_at: "relative-time", created_at: "relative-time" },
        },
      },
      { due_at: "2026-07-28", created_at: createdAt },
    )

    const out = stripAnsi(cap.output())
    expect(out).toMatch(/due_at\s+2026-07-28/)
    expect(out).toMatch(/created_at\s+2h ago/)
  })

  it("keeps all-day event Calendar Dates and the Exclusive End raw", () => {
    render(
      {
        kind: "event.get",
        display: {
          shape: "object",
          fields: ["start", "end"],
          format: { start: "relative-time", end: "relative-time" },
        },
      },
      { start: "2026-06-01", end: "2026-06-02" },
    )

    const out = stripAnsi(cap.output())
    expect(out).toMatch(/start\s+2026-06-01/)
    expect(out).toMatch(/end\s+2026-06-02/)
  })

  it("leaves Calendar Date payloads unchanged in JSON output", () => {
    process.env.WSPC_OUTPUT = "json"
    const payload = {
      start: "2026-06-01",
      end: "2026-06-02",
    }
    render(
      {
        kind: "event.get",
        display: {
          shape: "object",
          fields: ["start", "end"],
          format: { start: "relative-time", end: "relative-time" },
        },
      },
      payload,
    )

    expect(JSON.parse(cap.output())).toEqual(payload)
  })

  it("does not emit a leading blank line when every field is a block", () => {
    Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true })
    render(
      { kind: "x", display: { shape: "object" } },
      { note: "line one\nline two that is fairly long here" },
    )
    const out = stripAnsi(cap.output())
    expect(out.startsWith("\n")).toBe(false)
    expect(out).toMatch(/^ {2}note\n {4}line one/)
  })

  it("renders children as id-short + status badge + title items", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    render(
      { kind: "todo_get", display: { shape: "object", format: { id: "id-short" } } },
      {
        id: "tod_parent", title: "parent", status: "open", child_count: 2,
        children: [
          { id: "tod_aaaaaaaa1", title: "first sub", status: "open" },
          { id: "tod_bbbbbbbb2", title: "second sub", status: "done" },
        ],
      },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("children")
    expect(out).toContain("first sub")
    expect(out).toContain("second sub")
    expect(out).not.toContain('{"id"')
  })

  it("lists all children without the 10-item array cap", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    const children = Array.from({ length: 14 }, (_, i) => ({
      id: `tod_${String(i).padStart(8, "0")}`, title: `sub ${i}`, status: "open",
    }))
    render(
      { kind: "todo_get", display: { shape: "object" } },
      { id: "tod_parent", title: "p", status: "open", child_count: 14, children },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("sub 13")
    expect(out).not.toContain("more")
  })

  it("renders comments as id-short + relative-time + truncated content", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    render(
      { kind: "todo_get", display: { shape: "object" } },
      {
        id: "tod_parent", title: "p", status: "open",
        comments: [
          { id: "tdc_aaaaaaaa1", content: "first note", created_at: 1748736000000 },
          { id: "tdc_bbbbbbbb2", content: "second note", created_at: 1748736000000 },
        ],
      },
    )
    const out = stripAnsi(cap.output())
    expect(out).toContain("comments")
    expect(out).toContain("first note")
    expect(out).toContain("second note")
    expect(out).not.toContain('{"id"')
  })

  it("truncates long comment content in the inline list", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    const long = "x".repeat(200)
    render(
      { kind: "todo_get", display: { shape: "object" } },
      { id: "tod_p", title: "p", status: "open", comments: [{ id: "tdc_1", content: long, created_at: 1748736000000 }] },
    )
    const out = stripAnsi(cap.output())
    // content is truncated to a snippet (ellipsis), NOT the full 200 chars
    expect(out).toContain("…")
    expect(out).not.toContain("x".repeat(200))
  })

  it("lists all comments without the 10-item cap", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    const comments = Array.from({ length: 13 }, (_, i) => ({
      id: `tdc_${String(i).padStart(8, "0")}`, content: `note ${i}`, created_at: 1748736000000,
    }))
    render({ kind: "todo_get", display: { shape: "object" } }, { id: "tod_p", title: "p", status: "open", comments })
    const out = stripAnsi(cap.output())
    expect(out).toContain("note 12")
    expect(out).not.toContain("more")
  })

  describe("pagination footer", () => {
    it("pretty list with next_cursor → shows 'more results' and --cursor token", () => {
      const display: XCliDisplay = { shape: "list", columns: ["id", "title"] }
      render(
        { kind: "todo.list", display },
        {
          todos: [{ id: "tod_1", title: "Buy milk" }],
          next_cursor: "CURSORTOKEN",
        },
      )
      const out = stripAnsi(cap.output())
      expect(out).toContain("more results")
      expect(out).toContain("--cursor CURSORTOKEN")
    })

    it("pretty list WITHOUT next_cursor → does NOT show 'more results'", () => {
      const display: XCliDisplay = { shape: "list", columns: ["id", "title"] }
      render(
        { kind: "todo.list", display },
        {
          todos: [{ id: "tod_1", title: "Buy milk" }],
        },
      )
      const out = stripAnsi(cap.output())
      expect(out).not.toContain("more results")
    })

    it("JSON mode with next_cursor → does NOT show 'more results' (cursor is in JSON payload)", () => {
      process.env.WSPC_OUTPUT = "json"
      const display: XCliDisplay = { shape: "list", columns: ["id", "title"] }
      render(
        { kind: "todo.list", display },
        {
          todos: [{ id: "tod_1", title: "Buy milk" }],
          next_cursor: "CURSORTOKEN",
        },
      )
      const out = stripAnsi(cap.output())
      expect(out).not.toContain("more results")
    })

    it("pretty todo show with children_next_cursor → shows 'more children' and wspc todo ls --parent <id>", () => {
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
      render(
        { kind: "todo_get", display: { shape: "object" } },
        {
          id: "tod_parent123",
          title: "parent",
          status: "open",
          children: [{ id: "tod_child1", title: "sub", status: "open" }],
          children_next_cursor: "CHILDCURSOR",
        },
      )
      const out = stripAnsi(cap.output())
      expect(out).toContain("more children")
      expect(out).toContain("wspc todo ls --parent tod_parent123")
    })

    it("pretty todo show with comments_next_cursor → shows 'more comments' and wspc todo comment ls <id>", () => {
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
      render(
        { kind: "todo_get", display: { shape: "object" } },
        {
          id: "tod_parent123",
          title: "parent",
          status: "open",
          comments: [{ id: "tdc_1", content: "note", created_at: 1748736000000 }],
          comments_next_cursor: "COMMENTCURSOR",
        },
      )
      const out = stripAnsi(cap.output())
      expect(out).toContain("more comments")
      expect(out).toContain("wspc todo comment ls tod_parent123")
    })
  })
})

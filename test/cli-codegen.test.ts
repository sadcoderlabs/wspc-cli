import { describe, it, expect } from "vitest"
import { emitCommand } from "../tools/cli-codegen/emit.js"

describe("emitCommand", () => {
  it("emits a commander Command file for a POST with positional body field", () => {
    const code = emitCommand({
      operationId: "todo_create",
      method: "post",
      path: "/todo/items",
      summary: "Create a new todo item",
      xCli: {
        command: "todo add",
        positional: ["title"],
        aliases: { project: "p" },
        examples: ['wspc todo add "Buy milk"'],
      },
      bodyFields: [
        { name: "title", type: "string", required: true },
        { name: "project_id", type: "string", required: false },
        { name: "due_at", type: "string", required: false },
      ],
    })
    expect(code).toContain("// AUTO-GENERATED")
    expect(code).toContain('new Command("add")')
    expect(code).toContain('.argument("<title>"')
    expect(code).toContain('.option("-p, --project <value>"')
    expect(code).toContain('.option("--due-at <value>"')
    expect(code).toContain("todoCreate({")
    // Emitted action must surface HTTP errors instead of printing "undefined"
    expect(code).toContain("result.error || !result.response?.ok")
    expect(code).toContain("process.exitCode = 1")
    // Action dispatches output through the renderer with the operation's
    // kind tag (operationId verbatim); the renderer itself swallows
    // `undefined` data and chooses pretty vs JSON.
    expect(code).toContain('render({ kind: "todo_create"')
    expect(code).toContain("result.data")
    expect(code).toContain('from "../../../handwritten/output/render.js"')
  })

  it("inlines x-cli.display hints into the render call", () => {
    const code = emitCommand({
      operationId: "todo_list",
      method: "get",
      path: "/todo/items",
      summary: "List todos",
      xCli: {
        command: "todo ls",
        display: {
          shape: "list",
          columns: ["id", "title"],
          format: { id: "id-short", title: "truncate" },
          emptyMessage: "no todos",
        },
      },
      bodyFields: [],
    })
    expect(code).toContain('"shape":"list"')
    expect(code).toContain('"columns":["id","title"]')
    expect(code).toContain('"emptyMessage":"no todos"')
  })

  it("passes display: undefined when no display hints are present", () => {
    const code = emitCommand({
      operationId: "todo_create",
      method: "post",
      path: "/todo/items",
      summary: "Create a todo",
      xCli: { command: "todo add", positional: ["title"] },
      bodyFields: [{ name: "title", type: "string", required: true }],
    })
    expect(code).toContain("display: undefined")
  })

  it("returns null for hidden operations", () => {
    const code = emitCommand({
      operationId: "todo_restore",
      method: "post",
      path: "/todo/items/{id}/restore",
      summary: "Restore a deleted todo",
      xCli: { command: "_internal", hidden: true },
      bodyFields: [],
    })
    expect(code).toBeNull()
  })

  it("emits an array accumulator for options marked array: true", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: { tag: { array: true } },
      },
      bodyFields: [{ name: "tag", type: "array", required: false }],
    })
    expect(code).not.toBeNull()
    expect(code).toContain(
      '(val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[]',
    )
  })

  it("emits resolveTimezone, parseTimeInput, and --tz flag for datetime parser", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: { start: { parser: "datetime" } },
      },
      bodyFields: [{ name: "start", type: "string", required: false }],
    })
    expect(code).not.toBeNull()
    expect(code).toContain("const zone = resolveTimezone(opts.tz as string | undefined)")
    expect(code).toContain("startValue = parseTimeInput(opts.start as string, zone).toISO() ?? undefined")
    expect(code).toContain('.option("--tz <zone>"')
    expect(code).toContain("parseTimeInput, resolveTimezone")
  })

  it("branches on allDayFlag and uses parseDateOnly / inclusiveEndToExclusive", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: {
          start: { parser: "datetime", allDayFlag: "all_day" },
          end: { parser: "datetime", allDayFlag: "all_day", exclusive: true },
        },
      },
      bodyFields: [
        { name: "start", type: "string", required: false },
        { name: "end", type: "string", required: false },
      ],
    })
    expect(code).not.toBeNull()
    expect(code).toContain("if (opts.allDay) {")
    expect(code).toContain("startValue = parseDateOnly(opts.start as string)")
    expect(code).toContain("endValue = inclusiveEndToExclusive(opts.end as string)")
    expect(code).toContain('.option("--all-day"')
    expect(code).toContain("parseDateOnly")
    expect(code).toContain("inclusiveEndToExclusive")
  })

  it("uses mapsTo target as the SDK field name but keeps the flag named by option key", () => {
    const code = emitCommand({
      operationId: "event_list",
      method: "get",
      path: "/events",
      summary: "List events",
      xCli: {
        command: "event ls",
        options: { from: { mapsTo: "start_from", parser: "datetime" } },
      },
      bodyFields: [],
      queryFields: [{ name: "start_from", type: "string", required: false }],
    })
    expect(code).not.toBeNull()
    expect(code).toContain('.option("--from <value>"')
    expect(code).not.toContain('.option("--start-from')
    expect(code).toContain("start_from: fromValue")
  })

  it("emits event_ics_download with filename interpolation and no body block", () => {
    const code = emitCommand({
      operationId: "event_ics_download",
      method: "get",
      path: "/events/{filename}",
      summary: "Download ICS",
      xCli: { command: "event ics", positional: ["id"] },
      bodyFields: [],
      pathParams: ["filename"],
    })
    expect(code).not.toBeNull()
    expect(code).toContain("filename: `${id}.ics`")
    expect(code).not.toContain("body: {")
  })

  it("does not import attendee/date helpers when only datetime parser is used", () => {
    const code = emitCommand({
      operationId: "event_list",
      method: "get",
      path: "/events",
      summary: "List events",
      xCli: {
        command: "event ls",
        options: { since: { parser: "datetime" } },
      },
      bodyFields: [],
      queryFields: [{ name: "since", type: "string", required: false }],
    })
    expect(code).not.toBeNull()
    expect(code).not.toContain("parseAttendee")
    expect(code).not.toContain("parseDateOnly")
    expect(code).not.toContain("inclusiveEndToExclusive")
  })

  it("injects x-cli.fixedQuery constants into the SDK query block", () => {
    const code = emitCommand({
      operationId: "todo_get",
      method: "get",
      path: "/todo/items/{id}",
      xCli: {
        command: "todo show",
        positional: ["id"],
        fixedQuery: { include: "children" },
      },
      bodyFields: [],
      pathParams: ["id"],
      queryFields: [],
      depth: 2,
    })
    expect(code).toContain("query: {")
    expect(code).toContain('include: "children",')
    // fixedQuery must NOT become a CLI option
    expect(code).not.toContain('.option("--include')
  })

  it("does not emit a duplicate --all-day flag when body has an all_day field", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: {
          start: { parser: "datetime", allDayFlag: "all_day" },
        },
      },
      bodyFields: [
        { name: "start", type: "string", required: false },
        { name: "all_day", type: "boolean", required: false },
      ],
    })
    expect(code).not.toBeNull()
    // Exactly one --all-day option line (the body field's value option),
    // and no duplicate boolean flag from the allDayFlag emission.
    const allMatches = code!.match(/\.option\("--all-day[" ]/g) ?? []
    expect(allMatches.length).toBe(1)
    expect(code).not.toContain('.option("--all-day", "all_day")')
  })
})

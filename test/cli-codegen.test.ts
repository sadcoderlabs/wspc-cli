import { describe, it, expect } from "vitest"
import { emitCommand } from "../tools/cli-codegen/emit.js"

describe("emitCommand", () => {
  it("emits date-preserving occurrence boundaries with an implicit parse-only --tz", () => {
    const code = emitCommand({
      operationId: "event_occurrences",
      method: "get",
      path: "/calendar/events/{id}/occurrences",
      xCli: {
        command: "event occurrences",
        positional: ["id"],
        options: {
          from: { parser: "occurrence-boundary", mapsTo: "start", required: true },
          to: { parser: "occurrence-boundary", mapsTo: "end", required: true },
        },
      },
      bodyFields: [],
      pathParams: ["id"],
      queryFields: [
        { name: "start", type: "string", required: true },
        { name: "end", type: "string", required: true },
      ],
    })!

    expect(code).toContain('.option("--tz <zone>", "IANA timezone for relative time parsing")')
    expect(code).toContain("fromValue = parseOccurrenceBoundary(opts.from as string, zone)")
    expect(code).toContain("start: fromValue")
    expect(code).toContain('.requiredOption("--from <value>", "from")')
  })
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
    expect(code).toContain("input: {")
    expect(code).toContain("runSdkCommand({")
    expect(code).toContain("operation: todoCreate")
    expect(code).toContain('context: { kind: "todo_create"')
    expect(code).toContain('from "../../../handwritten/commands/run-sdk-command.js"')
    expect(code).not.toContain("loadSdkClient")
    expect(code).not.toContain("result.error || !result.response?.ok")
    expect(code).not.toContain('from "../../../handwritten/output/render.js"')
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
    expect(code).toContain("(val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[]")
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

  it("validates every all-day boundary with parseDateOnly", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: {
          start: { parser: "datetime", allDayFlag: "all_day" },
          end: { parser: "datetime", allDayFlag: "all_day" },
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
    expect(code).toContain("endValue = parseDateOnly(opts.end as string)")
    expect(code).toContain('.option("--all-day"')
    expect(code).toContain("parseDateOnly")
    expect(code).not.toContain("inclusiveEndToExclusive")
  })

  it("converts a datetime to UTC when the configured option is present", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: {
          start: {
            parser: "datetime",
            allDayFlag: "all_day",
            utcWhenPresent: "rrule",
          },
          rrule: { mapsTo: "recurrence_rule" },
        },
      },
      bodyFields: [
        { name: "start", type: "string", required: false },
        { name: "recurrence_rule", type: "string", required: false },
      ],
    })

    expect(code).toContain("opts.rrule !== undefined ? startDateTime.toUTC() : startDateTime")
    expect(code).toContain("const startDateTime = parseTimeInput(opts.start as string, zone)")
  })

  it("persists an explicit series time zone and keeps local offsets", () => {
    const code = emitCommand({
      operationId: "event_create",
      method: "post",
      path: "/events",
      summary: "Schedule",
      xCli: {
        command: "event add",
        options: {
          start: { parser: "datetime", utcWhenPresent: "rrule" },
          rrule: { mapsTo: "recurrence_rule" },
          tz: { parser: "series-time-zone", mapsTo: "time_zone" },
        },
      },
      bodyFields: [
        { name: "start", type: "string", required: false },
        { name: "recurrence_rule", type: "string", required: false },
        { name: "time_zone", type: "string", required: false },
      ],
    })

    expect(code).toContain('const recurringWithTimeZone = opts.rrule !== undefined && opts.rrule !== ""')
    expect(code).toContain(
      'const explicitSeriesTimeZone = opts.tz !== undefined && opts.tz !== "" && recurringWithTimeZone',
    )
    expect(code).toContain(
      "opts.rrule !== undefined && !explicitSeriesTimeZone ? startDateTime.toUTC() : startDateTime",
    )
    expect(code).toContain("const seriesTimeZoneValue = explicitSeriesTimeZone ? opts.tz : undefined")
    expect(code).toContain("time_zone: seriesTimeZoneValue")
    expect(code?.match(/\.option\("--tz/g)).toHaveLength(1)
  })

  it("prefetches event set only when explicit --tz needs recurring-series context", () => {
    const code = emitCommand({
      operationId: "event_update",
      method: "patch",
      path: "/events/{id}",
      summary: "Update",
      xCli: {
        command: "event set",
        positional: ["id"],
        options: {
          start: { parser: "datetime", utcWhenPresent: "rrule" },
          rrule: { mapsTo: "recurrence_rule" },
          tz: { parser: "series-time-zone", mapsTo: "time_zone" },
        },
      },
      bodyFields: [
        { name: "start", type: "string", required: false },
        { name: "recurrence_rule", type: "string", required: false },
        { name: "time_zone", type: "string", required: false },
      ],
      pathParams: ["id"],
    })

    expect(code).toContain('opts.tz !== undefined && opts.tz !== "" && opts.rrule === undefined')
    expect(code).toContain("operation: eventGet")
    expect(code).toContain("renderResult: false")
    expect(code).toContain(
      'const seriesTimeZoneValue = opts.tz === "" ? "" : explicitSeriesTimeZone ? opts.tz : undefined',
    )
    expect(code).toContain("time_zone: seriesTimeZoneValue")
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

  it("fixedQuery wins over a same-named real query parameter (no dup key, no flag)", () => {
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
      queryFields: [
        { name: "include", type: "string", required: false },
        { name: "include_deleted", type: "string", required: false },
      ],
      depth: 2,
    })
    // include appears exactly once in the query block, as the constant
    expect(code).toContain('include: "children",')
    expect(code).not.toContain("include: opts.include")
    // exactly one occurrence of an `include:` key (the constant). Count to be safe:
    const includeKeyCount = (code!.match(/\n\s+include:\s/g) ?? []).length
    expect(includeKeyCount).toBe(1)
    // the dynamic, non-fixed query field still emits normally
    expect(code).toContain("include_deleted: opts.includeDeleted,")
    // include must NOT become a CLI option, but include_deleted still may
    expect(code).not.toMatch(/\.option\("--include"[,)]/)
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

  it("emits addHelpText when description or examples are provided", () => {
    const code = emitCommand({
      operationId: "todo_create",
      method: "post",
      path: "/todo/items",
      summary: "Create a todo",
      description: "Guidelines: Make sure to split tasks.",
      xCli: {
        command: "todo add",
        examples: ['wspc todo add "My Task"'],
      },
      bodyFields: [],
    })
    expect(code).toContain('.addHelpText("after"')
    expect(code).toContain("Guidelines: Make sure to split tasks.")
    expect(code).toContain('wspc todo add \\"My Task\\"')
  })
})

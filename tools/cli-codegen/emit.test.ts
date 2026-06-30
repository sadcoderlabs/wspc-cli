import { describe, expect, it } from "vitest"
import { emitCommand } from "./emit.js"

describe("emitCommand: path params auto-positional", () => {
  it("auto-adds a required path param as a positional argument when x-cli.positional omits it", () => {
    const out = emitCommand({
      operationId: "invite_accept",
      method: "post",
      path: "/auth/invites/{id}/accept",
      xCli: { command: "invite accept", display: { shape: "object" } },
      bodyFields: [],
      pathParams: ["id"],
    })
    expect(out).not.toBeNull()
    const code = out!
    // The path param becomes a required positional and is wired into path:{}
    expect(code).toContain('.argument("<id>", "id")')
    expect(code).toContain("path: {")
    expect(code).toContain("id,")
    expect(code).toContain(".action(async (id, opts) =>")
  })

  it("does not duplicate a path param already listed in x-cli.positional", () => {
    const out = emitCommand({
      operationId: "todo_get",
      method: "get",
      path: "/todo/{id}",
      xCli: { command: "todo show", positional: ["id"], display: { shape: "object" } },
      bodyFields: [],
      pathParams: ["id"],
    })
    const code = out!
    const occurrences = code.split('.argument("<id>", "id")').length - 1
    expect(occurrences).toBe(1)
  })

  it("does not auto-expose the ics filename path param (special-cased to id)", () => {
    const out = emitCommand({
      operationId: "event_ics_download",
      method: "get",
      path: "/calendar/events/{filename}",
      xCli: { command: "event ics", positional: ["id"], display: { shape: "object" } },
      bodyFields: [],
      pathParams: ["filename"],
    })
    const code = out!
    expect(code).not.toContain('.argument("<filename>"')
    expect(code).toContain('.argument("<id>", "id")')
    expect(code).toContain("filename: `${id}.ics`")
  })
})

describe("emitCommand: array option without parser", () => {
  it("emits an accumulator option and passes string[] to mapsTo body field", () => {
    const out = emitCommand({
      operationId: "email_mark_read",
      method: "post",
      path: "/email/messages/mark-read",
      xCli: {
        command: "email read",
        options: { id: { array: true, mapsTo: "ids" } },
        display: { shape: "object" },
      },
      bodyFields: [{ name: "ids", type: "array", required: true }],
    })

    expect(out).not.toBeNull()
    const code = out!

    // Accumulator option is emitted for --id
    expect(code).toContain("--id <value>")
    expect(code).toContain("memo.push(val)")
    expect(code).toContain("[] as string[]")

    // Conversion variables are emitted
    expect(code).toContain("const idRaw = opts.id as string[]")
    expect(code).toContain("const ids = idRaw.length > 0 ? idRaw : undefined")

    // Body field uses the renamed variable (ids), not opts.id
    expect(code).toContain("ids: ids as string[]")
    expect(code).not.toContain("ids: opts.id")
  })

  it("variadic positional binds to mapsTo body field, suppresses --flag", () => {
    const out = emitCommand({
      operationId: "email_delete",
      method: "post",
      path: "/email/messages/delete",
      xCli: {
        command: "email rm",
        positional: ["id"],
        options: { id: { array: true, mapsTo: "ids" } },
        display: { shape: "object" },
      },
      bodyFields: [{ name: "ids", type: "array", required: true }],
    })

    expect(out).not.toBeNull()
    const code = out!

    // Variadic positional argument, NOT a --id flag
    expect(code).toContain('.argument("<id...>"')
    expect(code).not.toContain("--id <value>")

    // Conversion reads from the positional variable, not opts.id
    expect(code).toContain("const idRaw = id as string[]")
    expect(code).not.toContain("const idRaw = opts.id")

    // Body field uses the renamed converted variable
    expect(code).toContain("ids: ids as string[]")
  })

  it("handles array option without mapsTo (key equals field name)", () => {
    const out = emitCommand({
      operationId: "email_batch_delete",
      method: "post",
      path: "/email/messages/delete",
      xCli: {
        command: "email rm",
        options: { ids: { array: true } },
        display: { shape: "object" },
      },
      bodyFields: [{ name: "ids", type: "array", required: true }],
    })

    expect(out).not.toBeNull()
    const code = out!

    // Accumulator option for --ids
    expect(code).toContain("--ids <value>")
    expect(code).toContain("memo.push(val)")

    // Conversion variable named `ids`
    expect(code).toContain("const idsRaw = opts.ids as string[]")
    expect(code).toContain("const ids = idsRaw.length > 0 ? idsRaw : undefined")

    // Body field uses the variable
    expect(code).toContain("ids: ids as string[]")
  })
})

describe("emitCommand: body unwrap", () => {
  it("supports body.unwrap to flatten 1-level nested body wrapper field into top-level flags, and reconstructs it when calling the SDK", () => {
    const out = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        body: { unwrap: "config" },
        options: {
          target_bot: { mapsTo: "target_bot_username" },
        },
        display: { shape: "object" },
      },
      bodyFields: [
        { name: "transport", type: "string", required: true },
        { name: "target_bot_username", type: "string", required: false },
      ],
    })

    expect(out).not.toBeNull()
    const code = out!

    // Verify top-level flags are generated from unwrapped properties
    expect(code).toContain('.option("--transport <value>", "transport")')
    expect(code).toContain('.option("--target-bot <value>", "target_bot")')

    // Verify SDK call block reconstructs the unwrapped object
    expect(code).toContain("config: {")
    expect(code).toContain("transport: opts.transport,")
    expect(code).toContain("target_bot_username: opts.targetBot,")
  })
})

describe("emitCommand: JSON body fields", () => {
  it("JSON.parses an object-typed body field instead of passing the raw string", () => {
    const out = emitCommand({
      operationId: "todo_create",
      method: "post",
      path: "/todo",
      xCli: { command: "todo add", positional: ["title"], display: { shape: "object" } },
      bodyFields: [
        { name: "title", type: "string", required: true },
        { name: "description", type: "string", required: false },
        { name: "custom_fields", type: "object", required: false },
      ],
    })

    expect(out).not.toBeNull()
    const code = out!

    // Object field is parsed via the handwritten helper, not passed as a raw string.
    expect(code).toContain('custom_fields: parseJsonField(opts.customFields, "custom-fields"),')
    expect(code).not.toContain("custom_fields: opts.customFields,")
    // Helper is imported only because an object/array field is present.
    expect(code).toContain(
      'import { parseJsonField } from "../../../handwritten/utils/parse-json-field.js"',
    )

    // String fields are still passed through untouched.
    expect(code).toContain("description: opts.description,")
  })

  it("JSON.parses an array-typed body field that has no x-cli option owner", () => {
    const out = emitCommand({
      operationId: "todo_type_create",
      method: "post",
      path: "/todo/types",
      xCli: { command: "todo type add", display: { shape: "object" } },
      bodyFields: [
        { name: "name", type: "string", required: true },
        { name: "custom_fields", type: "array", required: false },
      ],
    })

    const code = out!
    expect(code).toContain('custom_fields: parseJsonField(opts.customFields, "custom-fields"),')
  })

  it("does not import the helper when no object/array body field is present", () => {
    const out = emitCommand({
      operationId: "todo_update",
      method: "patch",
      path: "/todo/{id}",
      xCli: { command: "todo set", positional: ["id"], display: { shape: "object" } },
      bodyFields: [{ name: "title", type: "string", required: false }],
      pathParams: ["id"],
    })

    const code = out!
    expect(code).not.toContain("parse-json-field")
    expect(code).toContain("title: opts.title,")
  })
})

describe("emitCommand: exitOnField", () => {
  it("emits process.exitCode check on specified response field", () => {
    const out = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        display: { shape: "object" },
        exitOnField: {
          path: "ok",
          failOn: false,
        },
      },
      bodyFields: [],
    })

    expect(out).not.toBeNull()
    const code = out!

    expect(code).toContain("render({ kind: \"org_push_keys\", display: {\"shape\":\"object\"} }, result.data)")
    expect(code).toContain("if (result.data?.ok === false) {")
    expect(code).toContain("process.exitCode = 1")
  })

  it("handles nested paths and string values for exitOnField", () => {
    const out = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        display: { shape: "object" },
        exitOnField: {
          path: "status.error",
          failOn: "partial_failure",
        },
      },
      bodyFields: [],
    })

    expect(out).not.toBeNull()
    const code = out!

    expect(code).toContain("if (result.data?.status?.error === \"partial_failure\") {")
    expect(code).toContain("process.exitCode = 1")
  })

  it("handles empty string, null/undefined, and malformed path in exitOnField safely", () => {
    // 1. Empty string path
    const outEmpty = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        display: { shape: "object" },
        exitOnField: {
          path: "",
          failOn: false,
        },
      },
      bodyFields: [],
    })
    expect(outEmpty).not.toBeNull()
    expect(outEmpty!).toContain("if (result.data === false) {")

    // 2. Malformed path with empty segments
    const outMalformed = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        display: { shape: "object" },
        exitOnField: {
          path: "status..error",
          failOn: "error",
        },
      },
      bodyFields: [],
    })
    expect(outMalformed).not.toBeNull()
    expect(outMalformed!).toContain("if (result.data?.status?.error === \"error\") {")

    // 3. Null path (cast to any for runtime test)
    const outNull = emitCommand({
      operationId: "org_push_keys",
      method: "post",
      path: "/org/push-keys",
      xCli: {
        command: "org push-keys",
        display: { shape: "object" },
        exitOnField: {
          path: null as any,
          failOn: true,
        },
      },
      bodyFields: [],
    })
    expect(outNull).not.toBeNull()
    expect(outNull!).toContain("if (result.data === true) {")
  })
})

describe("emitCommand: x-cli-bool bare boolean flag", () => {
  it("emits a bare boolean flag for x-cli-bool query fields", () => {
    const code = emitCommand({
      operationId: "todo_list",
      method: "get",
      path: "/todo",
      xCli: { command: "todo ls" },
      bodyFields: [],
      queryFields: [
        { name: "include_deleted", type: "string", required: false, description: "incl deleted", boolFlag: true },
      ],
      pathParams: [],
    } as any)
    expect(code).not.toBeNull()
    expect(code).toContain('.option("--include-deleted", "incl deleted")')
    expect(code).not.toContain("--include-deleted <value>")
  })
})


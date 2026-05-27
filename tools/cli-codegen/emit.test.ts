import { describe, expect, it } from "vitest"
import { emitCommand } from "./emit.js"

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

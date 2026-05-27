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
})

import { describe, expect, it } from "vitest"
import { shouldSkipRoute, extractQueryFields, groupCommands } from "./main.js"

describe("cli-codegen route skip predicate", () => {
  it("keeps regular CLI commands", () => {
    expect(shouldSkipRoute({ command: "email ls" })).toBe(false)
  })
  it("skips _internal sentinel", () => {
    expect(shouldSkipRoute({ command: "_internal", hidden: true })).toBe(true)
  })
  it("skips _handwritten sentinel", () => {
    expect(shouldSkipRoute({ command: "_handwritten", hidden: true })).toBe(true)
  })
  it("skips when hidden:true regardless of command", () => {
    expect(shouldSkipRoute({ command: "anything", hidden: true })).toBe(true)
  })
  it("skips _internal even without hidden flag", () => {
    expect(shouldSkipRoute({ command: "_internal" })).toBe(true)
  })
  it("skips _handwritten even without hidden flag", () => {
    expect(shouldSkipRoute({ command: "_handwritten" })).toBe(true)
  })
})

describe("cli-codegen extractQueryFields: booleanFlags from x-cli", () => {
  it("marks a query field as boolFlag when its name is in x-cli.booleanFlags", () => {
    const fields = extractQueryFields({
      operationId: "todo_list",
      parameters: [
        { name: "include_deleted", in: "query", required: false },
        { name: "limit", in: "query", required: false },
      ],
      "x-cli": { command: "todo ls", booleanFlags: ["include_deleted"] },
    })
    const includeDeleted = fields.find((f) => f.name === "include_deleted")
    const limit = fields.find((f) => f.name === "limit")
    expect(includeDeleted?.boolFlag).toBe(true)
    expect(limit?.boolFlag).toBe(false)
  })

  it("marks no fields as boolFlag when booleanFlags is absent", () => {
    const fields = extractQueryFields({
      operationId: "todo_list",
      parameters: [{ name: "include_deleted", in: "query", required: false }],
      "x-cli": { command: "todo ls" },
    })
    expect(fields[0]?.boolFlag).toBe(false)
  })

  it("marks no fields as boolFlag when booleanFlags is empty", () => {
    const fields = extractQueryFields({
      operationId: "todo_list",
      parameters: [{ name: "include_deleted", in: "query", required: false }],
      "x-cli": { command: "todo ls", booleanFlags: [] },
    })
    expect(fields[0]?.boolFlag).toBe(false)
  })
})

describe("cli-codegen groupCommands: paired commands", () => {
  const workspace = {
    routePath: "/drive/search",
    method: "get",
    op: { operationId: "drive_workspace_search", "x-cli": { command: "drive search" } },
  }
  const library = {
    routePath: "/drive/libraries/{id}/search",
    method: "get",
    op: {
      operationId: "drive_search",
      parameters: [{ name: "id", in: "path" as const, required: true }],
      "x-cli": { command: "drive search", positional: ["id"] },
    },
  }

  it("pairs a same-command op without path params as the fallback of the one with a path param", () => {
    expect(groupCommands([workspace, library])).toEqual([{ ...library, fallback: workspace }])
  })

  it("keeps distinct commands separate", () => {
    const other = { ...workspace, op: { ...workspace.op, "x-cli": { command: "drive ls" } } }
    expect(groupCommands([other, library])).toEqual([other, library])
  })

  it("throws with both operationIds when duplicates are not a pair", () => {
    const twin = { ...library, op: { ...library.op, operationId: "drive_search_v2" } }
    expect(() => groupCommands([library, twin])).toThrow(/drive_search.*drive_search_v2/)
  })

  it("throws when three ops share a command", () => {
    expect(() => groupCommands([workspace, library, workspace])).toThrow(/drive search/)
  })
})

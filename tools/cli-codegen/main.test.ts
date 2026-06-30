import { describe, expect, it } from "vitest"
import { shouldSkipRoute, extractQueryFields } from "./main.js"

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

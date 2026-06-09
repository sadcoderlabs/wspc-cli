import { describe, expect, it } from "vitest"
import { emitIndex, shouldSkipRoute } from "./main.js"

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

describe("cli-codegen index emitter", () => {
  it("uses a leaf command as the parent when it also has child commands", () => {
    const out = emitIndex([
      {
        commandPath: ["org", "invite"],
        filePath: "org/invite.ts",
        varName: "orgInviteCreateCommand",
      },
      {
        commandPath: ["org", "invite", "revoke"],
        filePath: "org/invite/revoke.ts",
        varName: "orgInviteRevokeCommand",
      },
    ])

    expect(out).toContain("root_org.addCommand(orgInviteCreateCommand)")
    expect(out).toContain("orgInviteCreateCommand.addCommand(orgInviteRevokeCommand)")
    expect(out).not.toContain("root_org_invite.addCommand(orgInviteCreateCommand)")
  })
})

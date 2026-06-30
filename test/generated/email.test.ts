import { describe, expect, it, vi, beforeEach } from "vitest"

const calls = {
  list: vi.fn(),
  get: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  delete: vi.fn(),
}

vi.mock("../../src/generated/sdk/index.js", () => ({
  emailList: (...a: unknown[]) => calls.list(...a),
  emailGet: (...a: unknown[]) => calls.get(...a),
  emailMarkRead: (...a: unknown[]) => calls.markRead(...a),
  emailMarkUnread: (...a: unknown[]) => calls.markUnread(...a),
  emailDelete: (...a: unknown[]) => calls.delete(...a),
}))
vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: {} }),
}))
vi.mock("../../src/handwritten/output/render.js", () => ({ render: vi.fn() }))

// Import generated commands AFTER mocks are set up.
// Actual export names (from reading the generated files):
//   ls.ts      → emailListCommand
//   show.ts    → emailGetCommand
//   read.ts    → emailMarkReadCommand
//   unread.ts  → emailMarkUnreadCommand
//   rm.ts      → emailDeleteCommand
import { emailListCommand } from "../../src/generated/cli/email/ls.js"
import { emailGetCommand } from "../../src/generated/cli/email/show.js"
import { emailMarkReadCommand } from "../../src/generated/cli/email/read.js"
import { emailMarkUnreadCommand } from "../../src/generated/cli/email/unread.js"
import { emailDeleteCommand } from "../../src/generated/cli/email/rm.js"

beforeEach(() => {
  for (const v of Object.values(calls)) {
    v.mockReset()
    v.mockResolvedValue({ data: {}, response: { ok: true, status: 200 } })
  }
})

describe("wspc email (generated)", () => {
  it("ls passes --since as query.since", async () => {
    await emailListCommand.parseAsync(["node", "ls", "--since", "1748400000000"])
    const q = calls.list.mock.calls[0]?.[0]?.query
    // since arrives as a string (codegen uses plain .option, no coercion)
    expect(q.since).toBe("1748400000000")
  })

  it("ls passes bare --include-deleted as query.include_deleted", async () => {
    await emailListCommand.parseAsync(["node", "ls", "--include-deleted"])
    const q = calls.list.mock.calls[0]?.[0]?.query
    expect(q.include_deleted).toBe(true)
  })

  it("show takes id as positional → path.id", async () => {
    await emailGetCommand.parseAsync(["node", "show", "eml_X"])
    expect(calls.get.mock.calls[0]?.[0]?.path).toMatchObject({ id: "eml_X" })
  })

  it("read takes variadic positional ids → body.ids[]", async () => {
    await emailMarkReadCommand.parseAsync(["node", "read", "eml_A", "eml_B"])
    expect(calls.markRead.mock.calls[0]?.[0]?.body).toMatchObject({
      ids: ["eml_A", "eml_B"],
    })
  })

  it("unread takes variadic positional ids → body.ids[]", async () => {
    await emailMarkUnreadCommand.parseAsync(["node", "unread", "eml_D", "eml_E"])
    expect(calls.markUnread.mock.calls[0]?.[0]?.body).toMatchObject({
      ids: ["eml_D", "eml_E"],
    })
  })

  it("rm takes variadic positional ids → body.ids[]", async () => {
    await emailDeleteCommand.parseAsync(["node", "rm", "eml_C"])
    expect(calls.delete.mock.calls[0]?.[0]?.body).toMatchObject({ ids: ["eml_C"] })
  })
})

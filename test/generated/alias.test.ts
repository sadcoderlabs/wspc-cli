import { describe, expect, it, vi, beforeEach } from "vitest"

const create = vi.fn()
const list = vi.fn()
const del = vi.fn()

vi.mock("../../src/generated/sdk/index.js", () => ({
  emailAliasCreate: (...a: unknown[]) => create(...a),
  emailAliasList: (...a: unknown[]) => list(...a),
  emailAliasDelete: (...a: unknown[]) => del(...a),
}))
vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: {} }),
}))
vi.mock("../../src/handwritten/output/render.js", () => ({ render: vi.fn() }))

// Actual export names (from reading the generated files):
//   alias/add.ts → emailAliasCreateCommand
//   alias/ls.ts  → emailAliasListCommand
//   alias/rm.ts  → emailAliasDeleteCommand
import { emailAliasCreateCommand } from "../../src/generated/cli/alias/add.js"
import { emailAliasListCommand } from "../../src/generated/cli/alias/ls.js"
import { emailAliasDeleteCommand } from "../../src/generated/cli/alias/rm.js"

beforeEach(() => {
  create.mockReset()
  list.mockReset()
  del.mockReset()
  create.mockResolvedValue({ data: {}, response: { ok: true } })
  list.mockResolvedValue({ data: { items: [] }, response: { ok: true } })
  del.mockResolvedValue({ data: {}, response: { ok: true } })
})

describe("wspc alias (generated)", () => {
  it("add takes email as positional → body.email", async () => {
    await emailAliasCreateCommand.parseAsync(["node", "add", "newsletter@wspc.app"])
    expect(create.mock.calls[0]?.[0]?.body).toMatchObject({ email: "newsletter@wspc.app" })
  })

  it("ls calls emailAliasList once", async () => {
    await emailAliasListCommand.parseAsync(["node", "ls"])
    expect(list).toHaveBeenCalledOnce()
  })

  it("rm takes email as positional → path.email (not path.id)", async () => {
    await emailAliasDeleteCommand.parseAsync(["node", "rm", "newsletter@wspc.app"])
    // Path param key is `email`, not `id` — confirmed against generated alias/rm.ts
    expect(del.mock.calls[0]?.[0]?.path).toMatchObject({ email: "newsletter@wspc.app" })
  })
})

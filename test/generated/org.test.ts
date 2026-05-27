import { describe, expect, it, vi, beforeEach } from "vitest"

const calls = {
  list: vi.fn(),
  get: vi.fn(),
}

vi.mock("../../src/generated/sdk/index.js", () => ({
  orgMembersList: (...a: unknown[]) => calls.list(...a),
  orgGet: (...a: unknown[]) => calls.get(...a),
}))

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: {} }),
}))

const mockRender = vi.fn()
vi.mock("../../src/handwritten/output/render.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/handwritten/output/render.js")>()
  return {
    render: (ctx: any, data: any) => {
      mockRender(ctx, data)
      return actual.render(ctx, data)
    },
  }
})

// Import generated commands AFTER mocks are set up.
import { orgMembersListCommand } from "../../src/generated/cli/org/members.js"

function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    })
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

beforeEach(() => {
  for (const v of Object.values(calls)) {
    v.mockReset()
    v.mockResolvedValue({ data: {}, response: { ok: true, status: 200 } })
  }
  mockRender.mockReset()
})

describe("wspc org (generated)", () => {
  it("members (empty) renders empty table message", async () => {
    const origTTY = process.stdout.isTTY
    const origEnv = process.env.WSPC_OUTPUT
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    delete process.env.WSPC_OUTPUT

    calls.list.mockResolvedValue({
      data: { members: [] },
      response: { ok: true, status: 200 },
    })

    const cap = captureStdout()
    try {
      await orgMembersListCommand.parseAsync(["node", "members"])
      expect(calls.list).toHaveBeenCalledOnce()
      expect(mockRender).toHaveBeenCalledOnce()
      const [ctx] = mockRender.mock.calls[0]!
      expect(ctx.display.shape).toBe("list")
      expect(ctx.display.dataPath).toBe("members")

      const out = stripAnsi(cap.output())
      expect(out).toContain("no items")
    } finally {
      cap.restore()
      Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true })
      if (origEnv === undefined) delete process.env.WSPC_OUTPUT
      else process.env.WSPC_OUTPUT = origEnv
    }
  })

  it("members (data) lists members with formatting", async () => {
    const origTTY = process.stdout.isTTY
    const origEnv = process.env.WSPC_OUTPUT
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    delete process.env.WSPC_OUTPUT

    const joinedAt = Date.now() - 5 * 60 * 1000 // 5m ago
    const mockMembers = {
      members: [
        {
          user_id: "usr_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
          email: "alice@example.com",
          display_name: "Alice Smith",
          joined_at: joinedAt,
        },
      ],
    }
    calls.list.mockResolvedValue({
      data: mockMembers,
      response: { ok: true, status: 200 },
    })

    const cap = captureStdout()
    try {
      await orgMembersListCommand.parseAsync(["node", "members"])
      expect(calls.list).toHaveBeenCalledOnce()
      expect(mockRender).toHaveBeenCalledOnce()
      const [ctx, data] = mockRender.mock.calls[0]!
      expect(data).toEqual(mockMembers)
      expect(ctx.display.shape).toBe("list")
      expect(ctx.display.dataPath).toBe("members")
      expect(ctx.display.columns).toEqual(["user_id", "email", "display_name", "joined_at"])
      expect(ctx.display.format.user_id).toBe("id-short")
      expect(ctx.display.format.joined_at).toBe("relative-time")

      const out = stripAnsi(cap.output())
      expect(out).toContain("USER_ID")
      expect(out).toContain("EMAIL")
      expect(out).toContain("DISPLAY_NAME")
      expect(out).toContain("JOINED_AT")
      expect(out).toContain("usr_01HW3K4N9V5G6Z8C2Q7B1Y0M3F")
      expect(out).toContain("alice@example.com")
      expect(out).toContain("Alice Smith")
      expect(out).toContain("5m ago")
    } finally {
      cap.restore()
      Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true })
      if (origEnv === undefined) delete process.env.WSPC_OUTPUT
      else process.env.WSPC_OUTPUT = origEnv
    }
  })
})

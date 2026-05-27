import { describe, expect, it, vi, beforeEach } from "vitest"

const calls = {
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}

vi.mock("../../src/generated/sdk/index.js", () => ({
  keyList: (...a: unknown[]) => calls.list(...a),
  keyCreate: (...a: unknown[]) => calls.create(...a),
  keyRevoke: (...a: unknown[]) => calls.revoke(...a),
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
import { keyListCommand } from "../../src/generated/cli/keys/ls.js"
import { keyCreateCommand } from "../../src/generated/cli/keys/create.js"
import { keyRevokeCommand } from "../../src/generated/cli/keys/rm.js"

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

describe("wspc keys (generated)", () => {
  it("ls renders a table using short ID and relative-time formatting", async () => {
    const mockKeys = {
      keys: [
        {
          id: "key_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
          label: "my-key",
          last_4: "abcd",
          created_at: 1748736000000,
          last_used_at: 1748736000000,
        },
      ],
    }
    calls.list.mockResolvedValue({
      data: mockKeys,
      response: { ok: true, status: 200 },
    })

    await keyListCommand.parseAsync(["node", "ls"])
    expect(calls.list).toHaveBeenCalledOnce()
    expect(mockRender).toHaveBeenCalledOnce()
    const [renderMeta, renderData] = mockRender.mock.calls[0]!
    expect(renderData).toEqual(mockKeys)
    expect(renderMeta.display.shape).toBe("list")
    expect(renderMeta.display.dataPath).toBe("keys")
    expect(renderMeta.display.columns).toEqual(["id", "label", "last_4", "created_at", "last_used_at"])
    expect(renderMeta.display.format.id).toBe("id-short")
    expect(renderMeta.display.format.created_at).toBe("relative-time")
    expect(renderMeta.display.format.last_used_at).toBe("relative-time")
  })

  it("create in pretty mode prints yellow warning in stdout", async () => {
    const origTTY = process.stdout.isTTY
    const origEnv = process.env.WSPC_OUTPUT
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    delete process.env.WSPC_OUTPUT

    const mockCreatedKey = {
      id: "key_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
      label: "my-key",
      api_key: "wspc_live_abcdef123456",
      created_at: 1748736000000,
    }
    calls.create.mockResolvedValue({
      data: mockCreatedKey,
      response: { ok: true, status: 200 },
    })

    const cap = captureStdout()
    try {
      await keyCreateCommand.parseAsync(["node", "create", "--label", "my-key"])
      expect(calls.create).toHaveBeenCalledOnce()
      expect(calls.create.mock.calls[0]?.[0]?.body).toEqual({ label: "my-key" })

      const out = cap.output()
      const plain = stripAnsi(out)
      expect(plain).toContain("api_key")
      expect(plain).toContain("wspc_live_abcdef123456")
      expect(plain).toContain("⚠  This is the only time you'll see this key. Save it now.")
      expect(out).toContain("\x1b[33m⚠  This is the only time you'll see this key. Save it now.\x1b[0m")
    } finally {
      cap.restore()
      Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true })
      if (origEnv === undefined) delete process.env.WSPC_OUTPUT
      else process.env.WSPC_OUTPUT = origEnv
    }
  })

  it("create in JSON mode outputs raw JSON and no warning", async () => {
    const origTTY = process.stdout.isTTY
    const origEnv = process.env.WSPC_OUTPUT
    process.env.WSPC_OUTPUT = "json"

    const mockCreatedKey = {
      id: "key_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
      label: "my-key",
      api_key: "wspc_live_abcdef123456",
      created_at: 1748736000000,
    }
    calls.create.mockResolvedValue({
      data: mockCreatedKey,
      response: { ok: true, status: 200 },
    })

    const cap = captureStdout()
    try {
      await keyCreateCommand.parseAsync(["node", "create", "--label", "my-key"])
      expect(calls.create).toHaveBeenCalledOnce()

      const out = cap.output()
      const plain = stripAnsi(out)
      const parsed = JSON.parse(plain.trim())
      expect(parsed).toEqual(mockCreatedKey)
      expect(plain).not.toContain("This is the only time you'll see this key")
    } finally {
      cap.restore()
      Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true })
      if (origEnv === undefined) delete process.env.WSPC_OUTPUT
      else process.env.WSPC_OUTPUT = origEnv
    }
  })

  it("rm maps positional parameter id to path.id", async () => {
    calls.revoke.mockResolvedValue({
      data: {},
      response: { ok: true, status: 200 },
    })
    await keyRevokeCommand.parseAsync(["node", "rm", "key_abc"])
    expect(calls.revoke).toHaveBeenCalledOnce()
    expect(calls.revoke.mock.calls[0]?.[0]?.path).toEqual({ id: "key_abc" })
  })
})

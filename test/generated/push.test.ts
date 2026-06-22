import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const mockPushConfigSet = vi.fn()
const mockPushConfigGet = vi.fn()
const mockPushConfigDelete = vi.fn()
const mockPushTest = vi.fn()

vi.mock("../../src/generated/sdk/index.js", () => ({
  pushConfigSet: (...a: unknown[]) => mockPushConfigSet(...a),
  pushConfigGet: (...a: unknown[]) => mockPushConfigGet(...a),
  pushConfigDelete: (...a: unknown[]) => mockPushConfigDelete(...a),
  pushTest: (...a: unknown[]) => mockPushTest(...a),
}))

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: {} }),
}))

const mockRender = vi.fn()
vi.mock("../../src/handwritten/output/render.js", () => ({
  render: (...a: unknown[]) => mockRender(...a),
}))

// Import generated commands AFTER mocks are set up.
import { pushConfigSetCommand } from "../../src/generated/cli/push/config/set.js"
import { pushConfigGetCommand } from "../../src/generated/cli/push/config/show.js"
import { pushConfigDeleteCommand } from "../../src/generated/cli/push/config/rm.js"
import { pushTestCommand } from "../../src/generated/cli/push/test.js"

beforeEach(() => {
  mockPushConfigSet.mockReset()
  mockPushConfigGet.mockReset()
  mockPushConfigDelete.mockReset()
  mockPushTest.mockReset()
  mockRender.mockReset()

  mockPushConfigSet.mockResolvedValue({ data: {}, response: { ok: true, status: 200 } })
  mockPushConfigGet.mockResolvedValue({ data: { configs: [] }, response: { ok: true, status: 200 } })
  mockPushConfigDelete.mockResolvedValue({ data: {}, response: { ok: true, status: 200 } })
  mockPushTest.mockResolvedValue({ data: { ok: true }, response: { ok: true, status: 200 } })
})

afterEach(() => {
  process.exitCode = undefined
})

describe("wspc push (generated)", () => {
  it("push config set flattens options and wraps in config body", async () => {
    await pushConfigSetCommand.parseAsync([
      "node",
      "set",
      "--transport",
      "telegram",
      "--target-bot-username",
      "@bot",
    ])
    expect(mockPushConfigSet).toHaveBeenCalledOnce()
    expect(mockPushConfigSet.mock.calls[0]?.[0]?.body).toEqual({
      config: {
        transport: "telegram",
        target_bot_username: "@bot",
      },
    })
  })

  it("push config show (empty) prints emptyMessage when no configs exist", async () => {
    mockPushConfigGet.mockResolvedValue({
      data: { configs: [] },
      response: { ok: true, status: 200 },
    })
    await pushConfigGetCommand.parseAsync(["node", "show"])
    expect(mockPushConfigGet).toHaveBeenCalledOnce()
    expect(mockRender).toHaveBeenCalledOnce()
    const [renderMeta] = mockRender.mock.calls[0]!
    expect(renderMeta.display.emptyMessage).toBe("(no push transports registered)")
  })

  it("push config show (data) renders table utilizing enum-badge for last_test_status", async () => {
    const mockData = {
      configs: [
        {
          transport: "telegram",
          target_bot_username: "@bot",
          last_test_at: "2026-05-27T00:00:00Z",
          last_test_status: "ok",
        },
      ],
    }
    mockPushConfigGet.mockResolvedValue({
      data: mockData,
      response: { ok: true, status: 200 },
    })
    await pushConfigGetCommand.parseAsync(["node", "show"])
    expect(mockPushConfigGet).toHaveBeenCalledOnce()
    expect(mockRender).toHaveBeenCalledOnce()

    const [renderMeta, renderData] = mockRender.mock.calls[0]!
    expect(renderData).toEqual(mockData)
    expect(renderMeta.display.columns).toContain("last_test_status")
    expect(renderMeta.display.format.last_test_status).toBe("enum-badge")
    expect(renderMeta.display.enumColorMap.last_test_status).toMatchObject({
      ok: { color: "green" },
      "*": { color: "red" },
    })
  })

  it("push config rm maps positional parameter transport to SDK path param", async () => {
    await pushConfigDeleteCommand.parseAsync(["node", "rm", "telegram"])
    expect(mockPushConfigDelete).toHaveBeenCalledOnce()
    expect(mockPushConfigDelete.mock.calls[0]?.[0]?.path).toEqual({
      transport: "telegram",
    })
  })

  it("push test sets exitCode=1 when ok is false", async () => {
    mockPushTest.mockResolvedValue({
      data: { ok: false },
      response: { ok: true, status: 200 },
    })

    await pushTestCommand.parseAsync(["node", "test", "--transport", "telegram"])
    expect(mockPushTest).toHaveBeenCalledOnce()
    expect(mockPushTest.mock.calls[0]?.[0]?.body).toEqual({
      transport: "telegram",
    })
    expect(process.exitCode).toBe(1)
  })
})

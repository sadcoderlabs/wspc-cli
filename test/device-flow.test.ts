import { describe, it, expect, vi } from "vitest"
import { runDeviceFlow } from "../src/handwritten/auth/device-flow.js"

describe("runDeviceFlow", () => {
  it("polls /oauth/token until tokens issued", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "dev_abc",
          user_code: "ABCD-1234",
          verification_uri: "https://app.wspc.ai/device",
          verification_uri_complete: "https://app.wspc.ai/device?user_code=ABCD-1234",
          expires_in: 600,
          interval: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "authorization_pending" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "wat_xyz",
          refresh_token: "wrt_xyz",
          expires_in: 900,
          token_type: "Bearer",
        }),
      })

    const onPrompt = vi.fn()
    const result = await runDeviceFlow({
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      fetchImpl: fetchMock as unknown as typeof fetch,
      onPrompt,
      sleepMs: async () => {},
    })

    expect(onPrompt).toHaveBeenCalledWith({
      verification_uri: "https://app.wspc.ai/device",
      verification_uri_complete: "https://app.wspc.ai/device?user_code=ABCD-1234",
      user_code: "ABCD-1234",
      expires_in: 600,
    })
    expect(result).toMatchObject({
      access_token: "wat_xyz",
      refresh_token: "wrt_xyz",
      expires_in: 900,
    })
  })

  it("throws on access_denied", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "dev_abc",
          user_code: "ABCD-1234",
          verification_uri: "https://app.wspc.ai/device",
          verification_uri_complete: "https://app.wspc.ai/device?user_code=ABCD-1234",
          expires_in: 600,
          interval: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "access_denied" }),
      })
    await expect(
      runDeviceFlow({
        baseUrl: "https://api.wspc.ai",
        clientId: "oac_wspc_cli",
        fetchImpl: fetchMock as unknown as typeof fetch,
        onPrompt: () => {},
        sleepMs: async () => {},
      }),
    ).rejects.toThrow(/access_denied/)
  })
})

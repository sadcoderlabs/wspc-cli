import { afterEach, describe, it, expect, vi } from "vitest"
import { createAuthInterceptor } from "../src/handwritten/auth/sdk-auth.js"
import { WspcAuthExpiredError } from "../src/index.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createAuthInterceptor", () => {
  it("attaches bearer header (apiKey mode)", async () => {
    const interceptor = createAuthInterceptor({ apiKey: "wspc_x" })
    const req = new Request("https://api.wspc.ai/todo/items")
    const out = await interceptor.onRequest(req)
    expect(out.headers.get("authorization")).toBe("Bearer wspc_x")
  })

  it("uses injected fetch in apiKey mode", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const globalFetch = vi.fn()
    vi.stubGlobal("fetch", globalFetch)

    const interceptor = createAuthInterceptor({
      apiKey: "wspc_x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const finalRes = await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))
    expect(finalRes.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it("refreshes on 401 with refresh_token mode and retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "wat_new",
        refresh_token: "wrt_new",
        expires_in: 900,
        token_type: "Bearer",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const onTokenRefresh = vi.fn()
    const interceptor = createAuthInterceptor({
      accessToken: "wat_old",
      refreshToken: "wrt_old",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      fetchImpl: fetchMock as unknown as typeof fetch,
      onTokenRefresh,
    })

    const finalRes = await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))
    expect(finalRes.ok).toBe(true)
    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: "wat_new",
      refreshToken: "wrt_new",
      expiresAt: expect.any(Number),
    })
  })

  it("throws WspcAuthExpiredError when refresh also returns 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }))

    const interceptor = createAuthInterceptor({
      accessToken: "wat_old",
      refreshToken: "wrt_old",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      fetchImpl: fetchMock as unknown as typeof fetch,
      onTokenRefresh: () => {},
    })

    await expect(interceptor.execute(new Request("https://api.wspc.ai/todo/items"))).rejects.toBeInstanceOf(
      WspcAuthExpiredError,
    )
  })
})

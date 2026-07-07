import { afterEach, describe, it, expect, vi } from "vitest"
import { createAuthInterceptor } from "../src/handwritten/auth/sdk-auth.js"
import { WspcAuthExpiredError } from "../src/index.js"
import { VERSION } from "../src/version.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

const UA = `@wspc/cli/${VERSION}`

describe("createAuthInterceptor", () => {
  it("attaches bearer header (apiKey mode)", async () => {
    const interceptor = createAuthInterceptor({ apiKey: "wspc_x" })
    const req = new Request("https://api.wspc.ai/todo/items")
    const out = await interceptor.onRequest(req)
    expect(out.headers.get("authorization")).toBe("Bearer wspc_x")
  })

  it("stamps the CLI version as user-agent on requests (both modes)", async () => {
    const apiKeyReq = await createAuthInterceptor({ apiKey: "wspc_x" }).onRequest(
      new Request("https://api.wspc.ai/todo/items"),
    )
    expect(apiKeyReq.headers.get("user-agent")).toBe(UA)

    const tokenReq = await createAuthInterceptor({
      accessToken: "wat",
      refreshToken: "wrt",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      onTokenRefresh: () => {},
    }).onRequest(new Request("https://api.wspc.ai/todo/items"))
    expect(tokenReq.headers.get("user-agent")).toBe(UA)
  })

  it("sends the CLI version as user-agent on the refresh request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "wat_new", refresh_token: "wrt_new", expires_in: 900 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const interceptor = createAuthInterceptor({
      accessToken: "wat_old",
      refreshToken: "wrt_old",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      fetchImpl: fetchMock as unknown as typeof fetch,
      onTokenRefresh: () => {},
    })
    await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))

    const refreshCall = fetchMock.mock.calls[1]!
    const headers = new Headers((refreshCall[1] as RequestInit).headers)
    expect(headers.get("user-agent")).toBe(UA)
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

  it("proactively refreshes an already-expired token instead of eating a 401", async () => {
    const fetchMock = vi
      .fn()
      // Proactive refresh fires first, before the API request.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "wat_new", refresh_token: "wrt_new", expires_in: 900 }),
          { status: 200 },
        ),
      )
      // Then the actual API request succeeds with the fresh token.
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const onTokenRefresh = vi.fn()
    const interceptor = createAuthInterceptor({
      accessToken: "wat_old",
      refreshToken: "wrt_old",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      expiresAt: 1_000, // already in the past relative to `now`
      now: () => 100_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onTokenRefresh,
    })

    const finalRes = await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))
    expect(finalRes.ok).toBe(true)

    // Exactly two calls — refresh then the request — with no wasted 401 round-trip.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.wspc.ai/auth/oauth/token")
    const apiReq = fetchMock.mock.calls[1]![0] as Request
    expect(apiReq.headers.get("authorization")).toBe("Bearer wat_new")
    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: "wat_new",
      refreshToken: "wrt_new",
      expiresAt: expect.any(Number),
    })
  })

  it("does not refresh when the stored token is still valid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const onTokenRefresh = vi.fn()
    const interceptor = createAuthInterceptor({
      accessToken: "wat_ok",
      refreshToken: "wrt",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      expiresAt: 1_000_000, // comfortably in the future
      now: () => 100_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onTokenRefresh,
    })

    const res = await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onTokenRefresh).not.toHaveBeenCalled()
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

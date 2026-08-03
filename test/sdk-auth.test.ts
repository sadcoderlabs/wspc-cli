import { afterEach, describe, it, expect, vi } from "vitest"
import { createAuthInterceptor, type PersistedTokens } from "../src/handwritten/auth/sdk-auth.js"
import { WspcAuthExpiredError } from "../src/index.js"
import { VERSION } from "../src/version.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

const UA = `@wspc/cli/${VERSION}`
const TOKEN_URL = "https://api.wspc.ai/auth/oauth/token"

// The server's half of the contract these tests exist for: refresh tokens are
// single-use, every refresh rotates, and presenting one that was already
// rotated away revokes the family (Sentry: auth.refresh_reuse_revoked).
// `fetchFor` hands out an independent mock per interceptor while all of them
// share one token ledger, the way separate CLI processes share one server.
function rotatingTokenServer(initialRefreshToken: string) {
  const live = new Set([initialRefreshToken])
  let rotations = 0
  const server = {
    refreshCalls: 0,
    fetchFor: () =>
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (url !== TOKEN_URL) return new Response(JSON.stringify({ ok: true }), { status: 200 })
        server.refreshCalls++
        const presented = new URLSearchParams(String(init?.body)).get("refresh_token")!
        if (!live.has(presented)) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 })
        }
        live.delete(presented)
        const next = `wrt_${++rotations}`
        live.add(next)
        return new Response(
          JSON.stringify({ access_token: `wat_${rotations}`, refresh_token: next, expires_in: 900 }),
          { status: 200 },
        )
      }),
  }
  return server
}

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

  it("does not double-refresh (reuse the same refresh_token) under concurrent requests", async () => {
    const server = rotatingTokenServer("wrt_old")
    const interceptor = createAuthInterceptor({
      accessToken: "wat_old",
      refreshToken: "wrt_old",
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      expiresAt: 1_000, // already expired relative to `now`
      now: () => 100_000,
      fetchImpl: server.fetchFor() as unknown as typeof fetch,
      onTokenRefresh: () => {},
    })

    // Two commands fire at once (e.g. drive path-executor's Promise.all).
    const results = await Promise.all([
      interceptor.execute(new Request("https://api.wspc.ai/todo/items")),
      interceptor.execute(new Request("https://api.wspc.ai/todo/items")),
    ])

    for (const res of results) expect(res.ok).toBe(true)
    // A single-flight refresh hits the token endpoint exactly once; without it,
    // the second concurrent request reuses wrt_old and revokes the family.
    expect(server.refreshCalls).toBe(1)
  })

  it("does not reuse a stale in-memory refresh_token after another instance rotated it", async () => {
    // Two interceptors built from the same on-disk state (e.g. `watch` rebuilds
    // one per reconnect via loadRealtimeAuthHeaders, or two `wspc` processes).
    // Instance A refreshes and rotates the token on disk; minutes later instance
    // B refreshes using the token it cached at startup — now stale. gap_ms ~8min
    // in Sentry matches this, not a sub-second concurrent race.
    const NOW = 100_000
    const server = rotatingTokenServer("wrt_old")
    // Stands in for the on-disk config that ConfigStore reads and writes.
    const disk: PersistedTokens = { accessToken: "wat_old", refreshToken: "wrt_old", expiresAt: 1_000 }

    const build = () => {
      const fetchMock = server.fetchFor()
      const interceptor = createAuthInterceptor({
        accessToken: disk.accessToken,
        refreshToken: disk.refreshToken, // both read the SAME disk token at startup
        baseUrl: "https://api.wspc.ai",
        clientId: "oac_wspc_cli",
        expiresAt: disk.expiresAt, // expired → each will refresh on first use
        now: () => NOW,
        fetchImpl: fetchMock as unknown as typeof fetch,
        loadPersisted: async () => ({ ...disk }),
        onTokenRefresh: ({ accessToken, refreshToken, expiresAt }) => {
          disk.accessToken = accessToken
          disk.refreshToken = refreshToken
          disk.expiresAt = expiresAt // persisted rotation, like store.update
        },
      })
      return { interceptor, fetchMock }
    }

    const a = build()
    const b = build() // started before A rotated; caches wrt_old in memory

    await a.interceptor.execute(new Request("https://api.wspc.ai/todo/items")) // rotates wrt_old -> wrt_1
    const res = await b.interceptor.execute(new Request("https://api.wspc.ai/todo/items"))

    expect(res.ok).toBe(true)
    // B adopts A's rotated tokens rather than presenting its superseded copy,
    // so it never reaches the token endpoint at all.
    const bTokenCalls = b.fetchMock.mock.calls.filter(
      ([input]) => input === "https://api.wspc.ai/auth/oauth/token",
    )
    expect(bTokenCalls).toHaveLength(0)
    const bApiReq = b.fetchMock.mock.calls[0]![0] as Request
    expect(bApiReq.headers.get("authorization")).toBe("Bearer wat_1")
  })

  it("still refreshes when the persisted access token is also expired", async () => {
    // Adopting persisted tokens must not swallow a genuinely needed refresh:
    // if what is on disk is stale too, we still rotate.
    const NOW = 100_000
    const disk: PersistedTokens = { accessToken: "wat_disk", refreshToken: "wrt_disk", expiresAt: 1_000 }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url === "https://api.wspc.ai/auth/oauth/token") {
        expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("wrt_disk")
        return new Response(
          JSON.stringify({ access_token: "wat_new", refresh_token: "wrt_new", expires_in: 900 }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const interceptor = createAuthInterceptor({
      accessToken: "wat_mem",
      refreshToken: "wrt_mem", // superseded by what is on disk
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      expiresAt: 1_000,
      now: () => NOW,
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadPersisted: async () => ({ ...disk }),
      onTokenRefresh: () => {},
    })

    const res = await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))
    expect(res.ok).toBe(true)
    const apiReq = fetchMock.mock.calls[1]![0] as Request
    expect(apiReq.headers.get("authorization")).toBe("Bearer wat_new")
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

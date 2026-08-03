import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { loadAuthedFetch, loadRealtimeAuthHeaders, loadSdkClient, loadSdkClientWithAuthedFetch } from "../src/handwritten/auth/load-sdk-client.js"
import { todoList } from "../src/generated/sdk/index.js"

describe("loadSdkClient", () => {
  it("throws clear error if not logged in (empty config)", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await expect(loadSdkClient({ store })).rejects.toThrow(/not logged in/i)
  })

  it("throws clear error if current_env set but has no credentials", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: { prod: { api_base: "https://api.wspc.ai", accounts: {} } },
    })
    await expect(loadSdkClient({ store })).rejects.toThrow(/not logged in/i)
  })

  it("builds a client when api_key present in config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: { prod: { api_base: "https://api.wspc.ai", current_account: "a@x.com", accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } } } },
    })
    const client = await loadSdkClient({ store })
    expect(client).toBeDefined()
    expect(client).not.toBeNull()
    expect((client as { _rawClient: unknown })._rawClient).toBeDefined()
  })

  it("routes generated SDK requests through consistency fetch", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-bookmark-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmarks: { todo: "todo_old" },
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } },
        },
      },
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request
      expect(req.headers.get("x-cb-todo")).toBe("todo_old")
      return new Response(JSON.stringify({ todos: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-cb-todo": "todo_new",
        },
      })
    })

    const client = await loadSdkClient({ store, fetchImpl: fetchImpl as unknown as typeof fetch })
    await todoList({
      client: client._rawClient,
      query: { project_id: "prj_1" },
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks?.todo).toBe("todo_new")
  })

  it("routes direct authenticated fetch through consistency fetch", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-authed-bookmark-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmarks: { auth: "auth_old" },
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } },
        },
      },
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      expect(req.headers.get("x-cb-auth")).toBe("auth_old")
      return new Response("{}", {
        status: 200,
        headers: { "x-cb-auth": "auth_new" },
      })
    })

    const { fetch: authedFetch } = await loadAuthedFetch({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await authedFetch("https://api.wspc.ai/auth/me")

    expect(fetchImpl).toHaveBeenCalledOnce()
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks?.auth).toBe("auth_new")
  })

  it("loads realtime auth headers from the existing auth layer", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-realtime-auth-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } },
        },
      },
    })

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      expect(req.url).toBe("https://api.wspc.ai/auth/me")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify({ email: "a@x.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })

    const { baseUrl, headers } = await loadRealtimeAuthHeaders({ store, fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(baseUrl).toBe("https://api.wspc.ai")
    expect(new Headers(headers).get("authorization")).toBe("Bearer wspc_x")
    expect(new Headers(headers).get("user-agent")).toMatch(/^@wspc\/cli\//)
  })

  it("refreshes OAuth tokens before loading realtime auth headers", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-realtime-refresh-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "a@x.com",
          accounts: {
            "a@x.com": {
              email: "a@x.com",
              access_token: "at_0",
              refresh_token: "rt_0",
            },
          },
        },
      },
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      if (req.url === "https://api.wspc.ai/auth/oauth/token") {
        return new Response(JSON.stringify({ access_token: "at_1", refresh_token: "rt_1", expires_in: 900 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (req.url === "https://api.wspc.ai/auth/me" && req.headers.get("authorization") === "Bearer at_0") {
        return new Response("", { status: 401 })
      }
      if (req.url === "https://api.wspc.ai/auth/me" && req.headers.get("authorization") === "Bearer at_1") {
        return new Response(JSON.stringify({ email: "a@x.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected request ${req.url}`)
    })

    const { headers } = await loadRealtimeAuthHeaders({ store, fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(new Headers(headers).get("authorization")).toBe("Bearer at_1")
    const config = await store.read()
    expect(config.envs.prod?.accounts["a@x.com"]?.access_token).toBe("at_1")
    expect(config.envs.prod?.accounts["a@x.com"]?.refresh_token).toBe("rt_1")
  })

  it("shares OAuth refresh state between generated SDK and direct authenticated fetch", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-shared-refresh-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "a@x.com",
          accounts: {
            "a@x.com": {
              email: "a@x.com",
              access_token: "at_0",
              refresh_token: "rt_0",
            },
          },
        },
      },
    })
    const refreshTokens: string[] = []
    const protectedAuthHeaders: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      if (req.url === "https://api.wspc.ai/auth/oauth/token") {
        const body = await req.text()
        const params = new URLSearchParams(body)
        refreshTokens.push(params.get("refresh_token") ?? "")
        if (refreshTokens.length === 1) {
          return new Response(JSON.stringify({ access_token: "at_1", refresh_token: "rt_1", expires_in: 900 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ access_token: "at_2", refresh_token: "rt_2", expires_in: 900 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }

      protectedAuthHeaders.push(req.headers.get("authorization") ?? "")
      if (protectedAuthHeaders.length === 1 || protectedAuthHeaders.length === 3) {
        return new Response("", { status: 401 })
      }
      if (req.url.startsWith("https://api.wspc.ai/todo/items")) {
        return new Response(JSON.stringify({ todos: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })

    const client = await loadSdkClientWithAuthedFetch({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await todoList({
      client: client._rawClient,
      query: { project_id: "prj_1" },
    })
    await client.fetch("https://api.wspc.ai/drive/libraries/lib_1/files/content?path=notes%2Fhello.txt")

    expect(refreshTokens).toEqual(["rt_0", "rt_1"])
    expect(protectedAuthHeaders).toEqual(["Bearer at_0", "Bearer at_1", "Bearer at_1", "Bearer at_2"])
    const config = await store.read()
    expect(config.envs.prod?.accounts["a@x.com"]?.access_token).toBe("at_2")
    expect(config.envs.prod?.accounts["a@x.com"]?.refresh_token).toBe("rt_2")
  })

  it("builds a client when OAuth tokens present in config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_PERSISTED",
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", access_token: "acc_token", refresh_token: "ref_token" } },
        },
      },
    })
    const client = await loadSdkClient({ store })
    expect(client).toBeDefined()
    expect((client as { _rawClient: unknown })._rawClient).toBeDefined()
  })

  it("throws actionable error when OAuth tokens but no client_id", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-no-cid-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", access_token: "acc_token", refresh_token: "ref_token" } },
        },
      },
    })
    await expect(loadSdkClient({ store })).rejects.toThrow(/no client_id.*wspc logout && wspc login/)
  })

  it("uses default ConfigStore when no store provided (just checks it doesn't throw on import)", async () => {
    // Verify the function is callable without arguments (uses default store)
    expect(typeof loadSdkClient).toBe("function")
  })

  it("refreshes with the token another session persisted, not the one it started with", async () => {
    // The interceptor caches credentials when the command starts, but a
    // concurrent `wspc` (or a `drive watch` reconnect) can rotate them first.
    // Presenting the copy this one started with is what makes the server revoke
    // the whole token family and log the user out.
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-rotated-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "oac_wspc_cli",
          current_account: "a@x.com",
          accounts: {
            "a@x.com": {
              email: "a@x.com",
              access_token: "wat_start",
              refresh_token: "wrt_start",
              access_token_expires_at: Date.now() - 60_000, // expired -> will refresh
            },
          },
        },
      },
    })

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      // The server has already rotated wrt_start away; presenting it again is
      // exactly the reuse that revokes the family.
      if (url.endsWith("/auth/oauth/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const { fetch: authedFetch } = await loadAuthedFetch({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    // Another session rotates the pair after this interceptor was built.
    await store.update((cfg) => {
      const a = cfg.envs.prod!.accounts!["a@x.com"]!
      a.access_token = "wat_rotated"
      a.refresh_token = "wrt_rotated"
      a.access_token_expires_at = Date.now() + 900_000
    })

    const res = await authedFetch("https://api.wspc.ai/todo/items")
    expect(res.ok).toBe(true)

    const tokenCalls = fetchImpl.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url
      return url.endsWith("/auth/oauth/token")
    })
    expect(tokenCalls).toEqual([])
    const apiReq = fetchImpl.mock.calls[0]![0] as Request
    expect(apiReq.headers.get("authorization")).toBe("Bearer wat_rotated")
  })
})

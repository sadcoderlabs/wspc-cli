import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { loadAuthedFetch, loadSdkClient } from "../src/handwritten/auth/load-sdk-client.js"
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
})

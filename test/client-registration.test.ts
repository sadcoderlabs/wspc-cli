import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { ensureClientId } from "../src/handwritten/auth/client-registration.js"

describe("ensureClientId", () => {
  it("registers + persists when no client_id present", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-register-"))
    const store = new ConfigStore({ configDir: dir })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client_id: "client_NEW_ID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const id = await ensureClientId({
      store,
      envName: "prod",
      baseUrl: "https://api.wspc.ai",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(id).toBe("client_NEW_ID")
    expect(fetchMock).toHaveBeenCalledOnce()
    const req = fetchMock.mock.calls[0]![0] as Request
    expect(req.url).toBe("https://api.wspc.ai/auth/oauth/register")
    const c = await store.read()
    expect(c.envs.prod?.client_id).toBe("client_NEW_ID")
  })

  it("sends stored bookmark and persists returned bookmark during registration", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-register-bookmark-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmarks: { auth: "auth_old" },
          accounts: {},
        },
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client_id: "client_NEW_ID" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-cb-auth": "auth_new",
        },
      }),
    )

    await ensureClientId({
      store,
      envName: "prod",
      baseUrl: "https://api.wspc.ai",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const req = fetchMock.mock.calls[0]![0] as Request
    expect(req.headers.get("x-cb-auth")).toBe("auth_old")
    const c = await store.read()
    expect(c.envs.prod?.consistency_bookmarks?.auth).toBe("auth_new")
  })

  it("persists returned bookmark when registering into an empty config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-register-empty-bookmark-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({ envs: {} })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client_id: "client_NEW_ID" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-cb-auth": "auth_new",
        },
      }),
    )

    await ensureClientId({
      store,
      envName: "prod",
      baseUrl: "https://api.wspc.ai",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const c = await store.read()
    expect(c.envs.prod?.client_id).toBe("client_NEW_ID")
    expect(c.envs.prod?.consistency_bookmarks?.auth).toBe("auth_new")
  })

  it("returns existing client_id without re-registering", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-register-existing-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      envs: { prod: { api_base: "https://api.wspc.ai", client_id: "client_EXISTING", accounts: {} } },
    })
    const fetchMock = vi.fn()
    const id = await ensureClientId({
      store,
      envName: "prod",
      baseUrl: "https://api.wspc.ai",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(id).toBe("client_EXISTING")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws when register endpoint returns non-2xx", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-register-fail-"))
    const store = new ConfigStore({ configDir: dir })
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))
    await expect(
      ensureClientId({
        store,
        envName: "prod",
        baseUrl: "https://api.wspc.ai",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/client_registration_failed.*500/)
  })
})

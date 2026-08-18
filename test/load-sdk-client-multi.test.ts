import { describe, it, expect, afterEach, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { loadSdkClient, loadAuthedFetch } from "../src/handwritten/auth/load-sdk-client.js"

function baseConfig() {
  return {
    schema_version: 2 as const,
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        client_id: "client_X",
        current_account: "a@x.com",
        accounts: {
          "a@x.com": { email: "a@x.com", access_token: "at_a", refresh_token: "rt_a" },
          "b@x.com": { email: "b@x.com", access_token: "at_b", refresh_token: "rt_b" },
        },
      },
    },
  }
}

afterEach(() => {
  delete process.env.WSPC_ACCOUNT
  vi.unstubAllGlobals()
})

describe("loadSdkClient (multi-account)", () => {
  it("builds a client for the active account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-multi-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(baseConfig())
    const client = await loadSdkClient({ store })
    expect((client as { _rawClient: unknown })._rawClient).toBeDefined()
  })

  it("honours WSPC_ACCOUNT override", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-override-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(baseConfig())
    process.env.WSPC_ACCOUNT = "zzz@x.com"
    await expect(loadSdkClient({ store })).rejects.toThrow(/no account 'zzz@x.com'/)
  })

  it("onTokenRefresh updates ONLY the active account slot", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-refresh-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2 as const,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "a@x.com",
          accounts: {
            "a@x.com": { email: "a@x.com", access_token: "at_a", refresh_token: "rt_a" },
            "b@x.com": { email: "b@x.com", access_token: "at_b", refresh_token: "rt_b" },
          },
        },
      },
    })

    let callCount = 0
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        callCount++
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
        if (callCount === 1) {
          // First call: the protected API request — simulate 401
          return new Response("", { status: 401 })
        }
        if (url.includes("/auth/oauth/token")) {
          // Second call: token refresh
          return new Response(
            JSON.stringify({ access_token: "at_a2", refresh_token: "rt_a2", expires_in: 900 }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        // Retry after refresh
        return new Response("{}", { status: 200 })
      },
    )

    const { fetch: af } = await loadAuthedFetch({ store })
    await af("https://api.wspc.ai/auth/me")

    const updated = await store.read()
    const acctA = updated.envs.prod!.accounts["a@x.com"]!
    const acctB = updated.envs.prod!.accounts["b@x.com"]!
    expect(acctA.access_token).toBe("at_a2")
    expect(acctA.refresh_token).toBe("rt_a2")
    expect(acctB.access_token).toBe("at_b")
    expect(acctB.refresh_token).toBe("rt_b")
  })

  it("warns on stderr when a rotated token cannot be written back to the account slot", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-lost-slot-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(baseConfig())

    let callCount = 0
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL): Promise<Response> => {
        callCount++
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
        if (callCount === 1) return new Response("", { status: 401 })
        if (url.includes("/auth/oauth/token")) {
          return new Response(
            JSON.stringify({ access_token: "at_a2", refresh_token: "rt_a2", expires_in: 900 }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        return new Response("{}", { status: 200 })
      },
    )

    const { fetch: af } = await loadAuthedFetch({ store })

    // The slot disappears after the interceptor resolved the account but before
    // the rotation lands, which is the shape that made a successful rotation
    // vanish silently and left the next refresh presenting a superseded token.
    const withoutA = baseConfig()
    delete (withoutA.envs.prod.accounts as Record<string, unknown>)["a@x.com"]
    await store.write(withoutA)

    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    await af("https://api.wspc.ai/auth/me")

    const written = stderr.mock.calls.map((call) => String(call[0])).join("")
    expect(written).toContain("a@x.com")
    expect(written).toContain("prod")
    expect(written).toMatch(/rotated/i)
    expect(written).not.toContain("rt_a2")
  })

  it("errors when multiple accounts and no current_account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-ambig-"))
    const store = new ConfigStore({ configDir: dir })
    const c = baseConfig()
    delete (c.envs.prod as { current_account?: string }).current_account
    await store.write(c)
    await expect(loadSdkClient({ store })).rejects.toThrow(/multiple accounts/)
  })
})

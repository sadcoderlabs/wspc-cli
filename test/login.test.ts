import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runLogin } from "../src/handwritten/auth/login.js"
import { fetchMe as realFetchMe } from "../src/handwritten/auth/fetch-me.js"
import { resolveLoginTarget, wantsJson } from "../src/handwritten/commands/login.js"
import { API_BASE } from "../src/version.js"
import { ConfigStore } from "../src/handwritten/config/index.js"

const me = async () => ({ user_id: "usr_1", email: "a@x.com" })

describe("resolveLoginTarget", () => {
  it("defaults to prod API_BASE and prod env", () => {
    expect(resolveLoginTarget({}, {})).toEqual({ baseUrl: API_BASE, envName: "prod" })
  })
  it("uses --api-base and defaults env to local", () => {
    expect(resolveLoginTarget({ apiBase: "http://127.0.0.1:8780" }, {})).toEqual({
      baseUrl: "http://127.0.0.1:8780",
      envName: "local",
    })
  })
  it("honors WSPC_API_BASE env var", () => {
    expect(resolveLoginTarget({}, { WSPC_API_BASE: "http://localhost:9000" })).toEqual({
      baseUrl: "http://localhost:9000",
      envName: "local",
    })
  })
  it("explicit --env wins over the default", () => {
    expect(resolveLoginTarget({ apiBase: "http://127.0.0.1:8780", env: "accept" }, {})).toEqual({
      baseUrl: "http://127.0.0.1:8780",
      envName: "accept",
    })
  })
})

describe("wantsJson", () => {
  it("false by default", () => expect(wantsJson({}, {})).toBe(false))
  it("true when opts.json is set", () => expect(wantsJson({ json: true }, {})).toBe(true))
  it("true when WSPC_OUTPUT=json (global --json preAction path)", () =>
    expect(wantsJson({}, { WSPC_OUTPUT: "json" })).toBe(true))
  it("false when WSPC_OUTPUT=pretty", () => expect(wantsJson({}, { WSPC_OUTPUT: "pretty" })).toBe(false))
})

describe("runLogin", () => {
  it("stores tokens under accounts[email] and sets it active", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-"))
    const store = new ConfigStore({ configDir: dir })
    const deviceFlow = vi.fn().mockResolvedValue({
      access_token: "wat_x",
      refresh_token: "wrt_x",
      expires_in: 900,
      token_type: "Bearer",
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      deviceFlow,
      fetchMe: me,
      now: () => 1748332800000,
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(c.current_env).toBe("prod")
    expect(c.envs.prod?.current_account).toBe("a@x.com")
    expect(c.envs.prod?.accounts["a@x.com"]).toMatchObject({
      email: "a@x.com",
      user_id: "usr_1",
      refresh_token: "wrt_x",
      access_token: "wat_x",
      access_token_expires_at: 1748332800000 + 900_000,
    })
  })

  it("does not overwrite a different existing account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-multi-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "old@x.com",
          accounts: { "old@x.com": { email: "old@x.com", access_token: "a", refresh_token: "r" } },
        },
      },
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      clientId: "client_X",
      deviceFlow: vi.fn().mockResolvedValue({
        access_token: "wat_new",
        refresh_token: "wrt_new",
        expires_in: 900,
        token_type: "Bearer",
      }),
      fetchMe: me, // returns a@x.com
      now: () => 1,
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts).sort()).toEqual(["a@x.com", "old@x.com"])
    expect(c.envs.prod?.current_account).toBe("a@x.com")
  })

  it("forwards onPrompt from caller into device flow (no silent swallow)", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-onprompt-"))
    const store = new ConfigStore({ configDir: dir })
    const writes: string[] = []
    const jsonEvents: Record<string, unknown>[] = []
    const deviceFlow = vi.fn().mockImplementation(async (o: { onPrompt: (p: unknown) => void }) => {
      o.onPrompt({
        verification_uri: "https://app.wspc.ai/device",
        verification_uri_complete: "https://app.wspc.ai/device?user_code=ABCD-1234",
        user_code: "ABCD-1234",
        expires_in: 600,
      })
      return { access_token: "wat_x", refresh_token: "wrt_x", expires_in: 900, token_type: "Bearer" }
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      deviceFlow,
      ensureClient: async () => "client_TEST",
      fetchMe: me,
      now: () => 1,
      output: { write: (s) => writes.push(s), writeJson: (e) => jsonEvents.push(e) },
    })
    expect(jsonEvents).toContainEqual(
      expect.objectContaining({ event: "device_code_issued", user_code: "ABCD-1234" }),
    )
    const human = writes.join("\n")
    // The prefilled link is the headline of the new UI.
    expect(human).toContain("https://app.wspc.ai/device?user_code=ABCD-1234")
    // Bare URL + code stay as a manual fallback.
    expect(human).toContain("https://app.wspc.ai/device")
    expect(human).toContain("ABCD-1234")
  })

  it("calls ensureClient when no explicit clientId is provided", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-ensure-"))
    const store = new ConfigStore({ configDir: dir })
    const ensureClient = vi.fn().mockResolvedValue("client_ENSURED")
    const deviceFlow = vi.fn().mockImplementation(async (o: { clientId: string }) => {
      expect(o.clientId).toBe("client_ENSURED")
      return { access_token: "wat_x", refresh_token: "wrt_x", expires_in: 900, token_type: "Bearer" }
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      ensureClient,
      deviceFlow,
      fetchMe: me,
      now: () => 1,
      output: { write: () => {}, writeJson: () => {} },
    })
    expect(ensureClient).toHaveBeenCalledWith("prod")
    expect(deviceFlow).toHaveBeenCalledOnce()
  })

  it("passes store and envName to deviceFlow and post-flow fetchMe during OAuth login", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-oauth-bootstrap-"))
    const store = new ConfigStore({ configDir: dir })
    const deviceFlow = vi.fn().mockResolvedValue({
      access_token: "wat_x",
      refresh_token: "wrt_x",
      expires_in: 900,
      token_type: "Bearer",
    })
    const fetchMe = vi.fn().mockResolvedValue({ user_id: "usr_1", email: "a@x.com" })

    await runLogin({
      store,
      envName: "staging",
      baseUrl: "https://api.staging.wspc.ai",
      clientId: "client_X",
      deviceFlow,
      fetchMe,
      now: () => 1,
      output: { write: () => {}, writeJson: () => {} },
    })

    expect(deviceFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.staging.wspc.ai",
        clientId: "client_X",
        store,
        envName: "staging",
      }),
    )
    expect(fetchMe).toHaveBeenCalledWith({
      baseUrl: "https://api.staging.wspc.ai",
      token: "wat_x",
      store,
      envName: "staging",
    })
  })

  it("drops stale (default) orphan after OAuth login resolves real email", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-orphan-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "(default)",
          accounts: { "(default)": { email: "(default)", access_token: "old", refresh_token: "old" } },
        },
      },
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      clientId: "client_X",
      deviceFlow: vi.fn().mockResolvedValue({
        access_token: "wat_new",
        refresh_token: "wrt_new",
        expires_in: 900,
        token_type: "Bearer",
      }),
      fetchMe: async () => ({ user_id: "usr_1", email: "a@x.com" }),
      now: () => 1,
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts)).toEqual(["a@x.com"])
    expect(c.envs.prod?.current_account).toBe("a@x.com")
  })

  it("writes api_key under accounts[email] in escape-hatch mode", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-key-"))
    const store = new ConfigStore({ configDir: dir })
    await runLogin({
      store,
      apiKey: "wspc_test_key",
      baseUrl: "https://api.wspc.ai",
      fetchMe: me,
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(c.envs.prod?.accounts["a@x.com"]?.api_key).toBe("wspc_test_key")
    expect(c.envs.prod?.accounts["a@x.com"]?.refresh_token).toBeUndefined()
    expect(c.envs.prod?.current_account).toBe("a@x.com")
  })

  it("preserves api-key login bookmark returned by auth/me on empty config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-key-bookmark-"))
    const store = new ConfigStore({ configDir: dir })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input)
      expect(req.url).toBe("https://api.wspc.ai/auth/me")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_test_key")
      return new Response(JSON.stringify({ user_id: "usr_1", email: "a@x.com" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-consistency-bookmark": "bookmark_after_me",
        },
      })
    })

    await runLogin({
      store,
      apiKey: "wspc_test_key",
      baseUrl: "https://api.wspc.ai",
      fetchMe: (opts) => realFetchMe({ ...opts, fetchImpl: fetchImpl as typeof fetch }),
      output: { write: () => {}, writeJson: () => {} },
    })

    const c = await store.read()
    expect(c.envs.prod?.consistency_bookmark).toBe("bookmark_after_me")
    expect(c.envs.prod?.accounts["a@x.com"]?.api_key).toBe("wspc_test_key")
  })

  it("passes store and envName to fetchMe during api-key login", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-key-fetch-me-"))
    const store = new ConfigStore({ configDir: dir })
    const fetchMe = vi.fn().mockResolvedValue({ user_id: "usr_1", email: "a@x.com" })

    await runLogin({
      store,
      envName: "staging",
      apiKey: "wspc_test_key",
      baseUrl: "https://api.staging.wspc.ai",
      fetchMe,
      output: { write: () => {}, writeJson: () => {} },
    })

    expect(fetchMe).toHaveBeenCalledWith({
      baseUrl: "https://api.staging.wspc.ai",
      token: "wspc_test_key",
      store,
      envName: "staging",
    })
  })
})

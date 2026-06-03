import { describe, it, expect } from "vitest"
import { resolveAccount } from "../src/handwritten/auth/resolve-account.js"
import type { WspcConfig } from "../src/handwritten/config/index.js"

function cfg(): WspcConfig {
  return {
    schema_version: 2,
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

describe("resolveAccount", () => {
  it("uses current_account when no override", () => {
    const r = resolveAccount(cfg())
    expect(r.email).toBe("a@x.com")
    expect(r.envName).toBe("prod")
    expect(r.apiBase).toBe("https://api.wspc.ai")
    expect(r.clientId).toBe("client_X")
  })

  it("override wins over current_account", () => {
    const r = resolveAccount(cfg(), { accountOverride: "b@x.com" })
    expect(r.email).toBe("b@x.com")
  })

  it("throws when override account does not exist", () => {
    expect(() => resolveAccount(cfg(), { accountOverride: "zzz@x.com" })).toThrow(
      /no account 'zzz@x.com'/,
    )
  })

  it("falls back to the sole account when no current_account", () => {
    const c = cfg()
    delete c.envs.prod!.current_account
    delete c.envs.prod!.accounts["b@x.com"]
    const r = resolveAccount(c)
    expect(r.email).toBe("a@x.com")
  })

  it("throws when multiple accounts and no current_account/override", () => {
    const c = cfg()
    delete c.envs.prod!.current_account
    expect(() => resolveAccount(c)).toThrow(/multiple accounts/)
  })

  it("throws not-logged-in when env has no accounts", () => {
    const c = cfg()
    c.envs.prod!.accounts = {}
    delete c.envs.prod!.current_account
    expect(() => resolveAccount(c)).toThrow(/not logged in/i)
  })

  it("throws not-logged-in when no current_env", () => {
    const c = cfg()
    delete c.current_env
    expect(() => resolveAccount(c)).toThrow(/not logged in/i)
  })

  it("throws not-logged-in when resolved account has no usable creds", () => {
    const c = cfg()
    c.envs.prod!.accounts = { "a@x.com": { email: "a@x.com" } }
    c.envs.prod!.current_account = "a@x.com"
    expect(() => resolveAccount(c)).toThrow(/not logged in/i)
  })
})

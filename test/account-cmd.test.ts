import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { listAccounts, switchAccount } from "../src/handwritten/commands/account.js"

function cfg() {
  return {
    schema_version: 2 as const,
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        client_id: "client_X",
        current_account: "a@x.com",
        accounts: {
          "a@x.com": { email: "a@x.com", user_id: "usr_a", access_token: "at", refresh_token: "rt", actor: "user" as const },
          "b@x.com": { email: "b@x.com", user_id: "usr_b", api_key: "wspc_k" },
        },
      },
    },
  }
}

describe("listAccounts", () => {
  it("returns accounts with active marked", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-acct-ls-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    const rows = await listAccounts(store)
    expect(rows).toEqual([
      { email: "a@x.com", user_id: "usr_a", actor: "user", auth: "oauth", active: true },
      { email: "b@x.com", user_id: "usr_b", actor: undefined, auth: "api_key", active: false },
    ])
  })

  it("returns empty list when no current env", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-acct-empty-"))
    const store = new ConfigStore({ configDir: dir })
    expect(await listAccounts(store)).toEqual([])
  })
})

describe("switchAccount", () => {
  it("sets current_account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-acct-sw-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await switchAccount(store, "b@x.com")
    const c = await store.read()
    expect(c.envs.prod!.current_account).toBe("b@x.com")
  })

  it("throws when account does not exist", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-acct-sw-bad-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await expect(switchAccount(store, "zzz@x.com")).rejects.toThrow(/no account 'zzz@x.com'/)
  })
})

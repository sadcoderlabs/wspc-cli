import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { runLogout } from "../src/handwritten/auth/logout.js"

function twoAccounts() {
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

describe("runLogout", () => {
  it("removes the active account and promotes the sole remaining one", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-logout-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(twoAccounts())
    const res = await runLogout({ store })
    expect(res.removed).toEqual(["a@x.com"])
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts)).toEqual(["b@x.com"])
    expect(c.envs.prod!.current_account).toBe("b@x.com")
  })

  it("removes a specific account by email, leaving active untouched", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-logout-email-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(twoAccounts())
    await runLogout({ store, email: "b@x.com" })
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts)).toEqual(["a@x.com"])
    expect(c.envs.prod!.current_account).toBe("a@x.com")
  })

  it("clears active (no auto-promote) when >1 remain after removing active", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-logout-many-"))
    const store = new ConfigStore({ configDir: dir })
    const c0 = twoAccounts()
    c0.envs.prod.accounts["c@x.com"] = { email: "c@x.com", access_token: "at_c", refresh_token: "rt_c" }
    await store.write(c0)
    await runLogout({ store }) // removes active a@x.com, b & c remain
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts).sort()).toEqual(["b@x.com", "c@x.com"])
    expect(c.envs.prod!.current_account).toBeUndefined()
  })

  it("--all clears every account in the env", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-logout-all-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(twoAccounts())
    await runLogout({ store, all: true })
    const c = await store.read()
    expect(c.envs.prod!.accounts).toEqual({})
    expect(c.envs.prod!.current_account).toBeUndefined()
    expect(c.envs.prod!.api_base).toBe("https://api.wspc.ai")
  })
})

import { describe, it, expect, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { loadSdkClient } from "../src/handwritten/auth/load-sdk-client.js"

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

  it("errors when multiple accounts and no current_account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-ambig-"))
    const store = new ConfigStore({ configDir: dir })
    const c = baseConfig()
    delete (c.envs.prod as { current_account?: string }).current_account
    await store.write(c)
    await expect(loadSdkClient({ store })).rejects.toThrow(/multiple accounts/)
  })
})

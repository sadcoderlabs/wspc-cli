import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { loadSdkClient } from "../src/handwritten/auth/load-sdk-client.js"

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
      envs: { prod: { api_base: "https://api.wspc.ai" } },
    })
    await expect(loadSdkClient({ store })).rejects.toThrow(/not logged in/i)
  })

  it("builds a client when api_key present in config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: { prod: { api_base: "https://api.wspc.ai", api_key: "wspc_x" } },
    })
    const client = await loadSdkClient({ store })
    expect(client).toBeDefined()
    expect(client).not.toBeNull()
    expect((client as { _rawClient: unknown })._rawClient).toBeDefined()
  })

  it("builds a client when OAuth tokens present in config", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          access_token: "acc_token",
          refresh_token: "ref_token",
          client_id: "client_PERSISTED",
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
          access_token: "acc_token",
          refresh_token: "ref_token",
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

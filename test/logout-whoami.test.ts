import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { runLogout } from "../src/handwritten/auth/logout.js"
import { runWhoami } from "../src/handwritten/auth/whoami.js"

describe("logout / whoami", () => {
  it("logout clears tokens for current env", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-logout-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: { prod: { api_base: "https://api.wspc.ai", refresh_token: "wrt_x", access_token: "wat_x" } },
    })
    await runLogout({ store })
    const c = await store.read()
    expect(c.envs.prod?.refresh_token).toBeUndefined()
    expect(c.envs.prod?.access_token).toBeUndefined()
    expect(c.envs.prod?.api_base).toBe("https://api.wspc.ai")
  })

  it("whoami returns logged-out marker when no creds", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-whoami-"))
    const store = new ConfigStore({ configDir: dir })
    const result = await runWhoami({
      store,
      fetchImpl: (async () => {
        throw new Error("should not call fetch")
      }) as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: "logged_out" })
  })

  it("whoami fetches /auth/me when access_token present", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-whoami-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: { prod: { api_base: "https://api.wspc.ai", access_token: "wat_x", access_token_expires_at: Date.now() + 60_000 } },
    })
    const fetchMock = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "usr_x", email: "alice@example.com" }),
    })) as unknown as typeof fetch
    const result = await runWhoami({ store, fetchImpl: fetchMock })
    expect(result).toEqual({ status: "logged_in", user: { id: "usr_x", email: "alice@example.com" } })
  })
})

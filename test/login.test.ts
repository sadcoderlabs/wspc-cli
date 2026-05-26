import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runLogin } from "../src/handwritten/auth/login.js"
import { ConfigStore } from "../src/handwritten/config/index.js"

describe("runLogin", () => {
  it("writes refresh token to config under current_env=prod", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-"))
    const store = new ConfigStore({ configDir: dir })
    const deviceFlow = vi.fn().mockResolvedValue({
      access_token: "wat_x",
      refresh_token: "wrt_x",
      expires_in: 900,
      token_type: "Bearer",
    })
    const now = () => 1748332800000

    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      clientId: "oac_wspc_cli",
      deviceFlow,
      now,
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(c.current_env).toBe("prod")
    expect(c.envs.prod).toMatchObject({
      api_base: "https://api.wspc.ai",
      refresh_token: "wrt_x",
      access_token: "wat_x",
      access_token_expires_at: 1748332800000 + 900_000,
    })
  })

  it("writes api_key in escape-hatch mode", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-"))
    const store = new ConfigStore({ configDir: dir })
    await runLogin({
      store,
      apiKey: "wspc_test_key",
      baseUrl: "https://api.wspc.ai",
      output: { write: () => {}, writeJson: () => {} },
    })
    const c = await store.read()
    expect(c.envs.prod?.api_key).toBe("wspc_test_key")
    expect(c.envs.prod?.refresh_token).toBeUndefined()
  })
})

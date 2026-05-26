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

  it("forwards onPrompt from caller into device flow (no silent swallow)", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-onprompt-"))
    const store = new ConfigStore({ configDir: dir })
    const writes: string[] = []
    const jsonEvents: Record<string, unknown>[] = []
    const deviceFlow = vi.fn().mockImplementation(async (o: { onPrompt: (p: unknown) => void }) => {
      o.onPrompt({ verification_uri: "https://app.wspc.ai/device", user_code: "ABCD-1234", expires_in: 600 })
      return {
        access_token: "wat_x",
        refresh_token: "wrt_x",
        expires_in: 900,
        token_type: "Bearer",
      }
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      deviceFlow,
      ensureClient: async () => "client_TEST",
      now: () => 1,
      output: {
        write: (s) => writes.push(s),
        writeJson: (e) => jsonEvents.push(e),
      },
    })
    // The output side received the prompt event…
    expect(jsonEvents).toContainEqual(
      expect.objectContaining({ event: "device_code_issued", user_code: "ABCD-1234" }),
    )
    // …and the human-readable verification_uri line landed in stdout.
    expect(writes.some((l) => l.includes("verification_uri:"))).toBe(true)
    expect(writes.some((l) => l.includes("ABCD-1234"))).toBe(true)
  })

  it("calls ensureClient when no explicit clientId is provided", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-ensure-"))
    const store = new ConfigStore({ configDir: dir })
    const ensureClient = vi.fn().mockResolvedValue("client_ENSURED")
    const deviceFlow = vi.fn().mockImplementation(async (o: { clientId: string }) => {
      // Verify ensureClient's id was forwarded into the device flow
      expect(o.clientId).toBe("client_ENSURED")
      return {
        access_token: "wat_x",
        refresh_token: "wrt_x",
        expires_in: 900,
        token_type: "Bearer",
      }
    })
    await runLogin({
      store,
      baseUrl: "https://api.wspc.ai",
      ensureClient,
      deviceFlow,
      now: () => 1,
      output: { write: () => {}, writeJson: () => {} },
    })
    expect(ensureClient).toHaveBeenCalledWith("prod")
    expect(deviceFlow).toHaveBeenCalledOnce()
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

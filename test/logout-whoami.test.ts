import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { runLogout } from "../src/handwritten/auth/logout.js"

/**
 * `runWhoami` is gone — the `whoami` command now goes through `loadSdkClient`
 * + the auth interceptor so 401 → token refresh works (previously, raw
 * fetch was used and expired access tokens looked like "logged_out"). The
 * command's end-to-end behaviour is exercised via the SDK auth flow tests
 * in sdk-auth.test.ts; logout still owns its own unit test below.
 */
describe("logout", () => {
  it("clears tokens for current env", async () => {
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
})

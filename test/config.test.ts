import { describe, it, expect, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"

describe("ConfigStore", () => {
  let dir: string
  let store: ConfigStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-"))
    store = new ConfigStore({ configDir: dir })
  })

  it("returns empty config when file does not exist", async () => {
    const c = await store.read()
    expect(c).toEqual({ envs: {} })
  })

  it("round-trips a written config", async () => {
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          refresh_token: "wrt_test",
          access_token: "wat_test",
          access_token_expires_at: 1748332800000,
        },
      },
    })
    const c = await store.read()
    expect(c.current_env).toBe("prod")
    expect(c.envs.prod?.refresh_token).toBe("wrt_test")
  })

  it("creates config dir with 0700 permissions", async () => {
    await store.write({ envs: {} })
    const stat = await fs.stat(dir)
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o700)
    }
  })
})

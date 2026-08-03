import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"

// Every token refresh now re-reads the config to avoid presenting a rotated
// refresh token, so reads happen constantly while other `wspc` processes are
// writing. A truncate-in-place write lets a reader observe a half-written file
// and blow up with a JSON parse error mid-command; the write has to land whole.
describe("ConfigStore.write (atomic)", () => {
  let dir: string
  let store: ConfigStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-atomic-"))
    store = new ConfigStore({ configDir: dir })
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  function configOfSize(marker: string) {
    const accounts: Record<string, unknown> = {}
    // Large enough that a truncating write leaves a wide window for a reader.
    for (let i = 0; i < 400; i++) {
      accounts[`user${i}@example.com`] = {
        email: `user${i}@example.com`,
        access_token: `${marker}_at_${i}`.padEnd(120, "x"),
        refresh_token: `${marker}_rt_${i}`.padEnd(120, "y"),
        access_token_expires_at: 1_700_000_000_000 + i,
      }
    }
    return { current_env: "prod", envs: { prod: { api_base: "https://api.wspc.ai", accounts } } }
  }

  it("never exposes a partially written config to a concurrent reader", async () => {
    await store.write(configOfSize("seed") as never)

    const failures: string[] = []
    let stop = false
    const reader = (async () => {
      while (!stop) {
        try {
          const cfg = await store.read()
          // A torn read that still parses must not lose the accounts either.
          expect(Object.keys(cfg.envs.prod?.accounts ?? {})).toHaveLength(400)
        } catch (e) {
          failures.push(String(e))
        }
        await new Promise((r) => setImmediate(r))
      }
    })()

    for (let i = 0; i < 40; i++) {
      await store.write(configOfSize(`gen${i}`) as never)
    }
    stop = true
    await reader

    expect(failures).toEqual([])
  })

  it("leaves no temp files behind", async () => {
    await store.write(configOfSize("seed") as never)
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(["config.json"])
  })
})

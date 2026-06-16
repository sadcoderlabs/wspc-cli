import { describe, it, expect, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"

// Regression coverage for the multi-session token clobber: two independent
// write paths (token refresh + consistency bookmark) both did an unlocked
// read-modify-write of the whole config, so a bookmark write from a stale
// snapshot could resurrect an already-rotated refresh_token. `update` must
// serialize writers and re-read inside the lock so each only touches its field.
describe("ConfigStore.update (locked read-modify-write)", () => {
  let dir: string
  let store: ConfigStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-lock-"))
    store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", refresh_token: "RT0", access_token: "AT0" } },
        },
      },
    })
  })

  it("applies the mutator and persists", async () => {
    await store.update((cfg) => {
      cfg.envs.prod!.accounts["a@x.com"]!.refresh_token = "RT1"
    })
    const c = await store.read()
    expect(c.envs.prod!.accounts["a@x.com"]!.refresh_token).toBe("RT1")
  })

  it("a concurrent bookmark write does not clobber a token refresh write", async () => {
    // Mirror the real race: a token-refresh writeback and a bookmark writeback
    // fire concurrently. Both fields must survive — neither path may overwrite
    // the whole config from a snapshot taken before the other's change.
    await Promise.all([
      store.update((cfg) => {
        cfg.envs.prod!.accounts["a@x.com"]!.refresh_token = "RT1"
        cfg.envs.prod!.accounts["a@x.com"]!.access_token = "AT1"
      }),
      store.update((cfg) => {
        cfg.envs.prod!.consistency_bookmarks ??= {}
        cfg.envs.prod!.consistency_bookmarks.todo = "B2"
      }),
    ])
    const c = await store.read()
    expect(c.envs.prod!.accounts["a@x.com"]!.refresh_token).toBe("RT1")
    expect(c.envs.prod!.consistency_bookmarks?.todo).toBe("B2")
  })

  it("does not lose updates under concurrent writers", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.update((cfg) => {
          cfg.envs.prod!.accounts[`u${i}@x.com`] = { email: `u${i}@x.com` }
        }),
      ),
    )
    const c = await store.read()
    const emails = Object.keys(c.envs.prod!.accounts)
    expect(emails).toContain("a@x.com")
    for (let i = 0; i < 25; i++) expect(emails).toContain(`u${i}@x.com`)
  })
})

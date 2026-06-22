import { describe, it, expect, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { switchAccount } from "../src/handwritten/commands/account.js"

class DelayedDirectWriteConfigStore extends ConfigStore {
  private updateDepth = 0
  private delayedWrite?: { started: () => void; release: Promise<void> }

  delayNextDirectWrite(delayedWrite: { started: () => void; release: Promise<void> }): void {
    this.delayedWrite = delayedWrite
  }

  override async update(mutate: Parameters<ConfigStore["update"]>[0]): Promise<void> {
    this.updateDepth += 1
    try {
      await super.update(mutate)
    } finally {
      this.updateDepth -= 1
    }
  }

  override async write(config: Parameters<ConfigStore["write"]>[0]): Promise<void> {
    const delayedWrite = this.updateDepth === 0 ? this.delayedWrite : undefined
    if (delayedWrite) {
      this.delayedWrite = undefined
      delayedWrite.started()
      await delayedWrite.release
    }
    await super.write(config)
  }
}

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
    store = new DelayedDirectWriteConfigStore({ configDir: dir })
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

  it("command mutations do not clobber interleaved bookmark updates", async () => {
    const delayedStore = store as DelayedDirectWriteConfigStore
    let releaseWrite!: () => void
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const writeStarted = new Promise<void>((resolve) => {
      delayedStore.delayNextDirectWrite({ started: resolve, release })
    })

    await store.update((cfg) => {
      cfg.envs.prod!.accounts["b@x.com"] = { email: "b@x.com" }
    })

    const switchPromise = switchAccount(store, "b@x.com")
    const first = await Promise.race([
      writeStarted.then(() => "delayed" as const),
      switchPromise.then(() => "completed" as const),
    ])
    await store.update((cfg) => {
      cfg.envs.prod!.consistency_bookmarks ??= {}
      cfg.envs.prod!.consistency_bookmarks.todo = "B2"
    })
    if (first === "delayed") {
      releaseWrite()
      await switchPromise
    }

    const c = await store.read()
    expect(c.envs.prod!.current_account).toBe("b@x.com")
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

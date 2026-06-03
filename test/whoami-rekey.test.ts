import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { backfillActiveEmail } from "../src/handwritten/commands/whoami.js"

describe("backfillActiveEmail", () => {
  it("renames (default) placeholder to the real email", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-backfill-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "(default)",
          accounts: { "(default)": { email: "(default)", access_token: "at", refresh_token: "rt" } },
        },
      },
    })
    await backfillActiveEmail(store, "prod", "real@x.com", "usr_1")
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts)).toEqual(["real@x.com"])
    expect(c.envs.prod!.current_account).toBe("real@x.com")
    expect(c.envs.prod!.accounts["real@x.com"]).toMatchObject({ email: "real@x.com", user_id: "usr_1" })
  })

  it("is a no-op when there is no placeholder", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-backfill-noop-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "real@x.com",
          accounts: { "real@x.com": { email: "real@x.com", access_token: "at", refresh_token: "rt" } },
        },
      },
    })
    await backfillActiveEmail(store, "prod", "real@x.com", "usr_1")
    const c = await store.read()
    expect(Object.keys(c.envs.prod!.accounts)).toEqual(["real@x.com"])
  })
})

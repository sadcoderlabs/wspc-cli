import { describe, it, expect, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore, rekeyLegacyAccount, type WspcConfig } from "../src/handwritten/config/index.js"

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
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "a@x.com",
          accounts: {
            "a@x.com": {
              email: "a@x.com",
              refresh_token: "wrt_test",
              access_token: "wat_test",
              access_token_expires_at: 1748332800000,
            },
          },
        },
      },
    })
    const c = await store.read()
    expect(c.current_env).toBe("prod")
    expect(c.envs.prod?.accounts["a@x.com"]?.refresh_token).toBe("wrt_test")
  })

  it("creates config dir with 0700 permissions", async () => {
    await store.write({ envs: {} })
    const stat = await fs.stat(dir)
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o700)
    }
  })

  it("migrates a v1 env (env-level creds) into accounts[(default)]", async () => {
    // Write a legacy v1-shaped config by hand (creds at env level, no accounts).
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            client_id: "client_X",
            refresh_token: "wrt_legacy",
            access_token: "wat_legacy",
            access_token_expires_at: 1748332800000,
            actor: "agent",
            agent_label: "bot",
          },
        },
      }),
      "utf8",
    )
    const c = await store.read()
    const prod = c.envs.prod!
    expect(prod.api_base).toBe("https://api.wspc.ai")
    expect(prod.client_id).toBe("client_X")
    expect(prod.current_account).toBe("(default)")
    expect(prod.accounts["(default)"]).toMatchObject({
      email: "(default)",
      refresh_token: "wrt_legacy",
      access_token: "wat_legacy",
      access_token_expires_at: 1748332800000,
      actor: "agent",
      agent_label: "bot",
    })
    // Env-level cred fields are stripped after migration.
    expect((prod as unknown as Record<string, unknown>).refresh_token).toBeUndefined()
  })

  it("leaves an env with no creds as empty accounts map", async () => {
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({ current_env: "prod", envs: { prod: { api_base: "https://api.wspc.ai" } } }),
      "utf8",
    )
    const c = await store.read()
    expect(c.envs.prod!.accounts).toEqual({})
  })

  it("keeps an already-v2 env untouched", async () => {
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            current_account: "a@x.com",
            accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_k" } },
          },
        },
      }),
      "utf8",
    )
    const c = await store.read()
    expect(c.envs.prod!.accounts["a@x.com"]).toMatchObject({ email: "a@x.com", api_key: "wspc_k" })
  })

  it("drops legacy env-level consistency bookmark", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-legacy-bookmark-"))
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            consistency_bookmark: "bookmark_legacy",
            accounts: {},
          },
        },
      }),
    )
    const store = new ConfigStore({ configDir: dir })
    const config = await store.read()
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
  })

  it("normalizes service consistency bookmarks when present", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bookmarks-"))
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            consistency_bookmarks: {
              auth: "auth_1",
              todo: "todo_1",
              calendar: "cal_1",
              email: "email_1",
              push: "push_1",
              bad_service: "ignored",
            },
            accounts: {},
          },
        },
      }),
    )
    const store = new ConfigStore({ configDir: dir })
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks).toEqual({
      auth: "auth_1",
      todo: "todo_1",
      calendar: "cal_1",
      email: "email_1",
      push: "push_1",
    })
  })

  it("drops malformed service consistency bookmark values", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bad-bookmarks-"))
    await fs.writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            consistency_bookmarks: {
              auth: 123,
              todo: "todo_1",
              calendar: null,
            },
            accounts: {},
          },
        },
      }),
    )
    const store = new ConfigStore({ configDir: dir })
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks).toEqual({ todo: "todo_1" })
  })
})

describe("rekeyLegacyAccount", () => {
  function legacyCfg(): WspcConfig {
    return {
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
    }
  }

  it("renames (default) to the real email and sets user_id", () => {
    const cfg = legacyCfg()
    const result = rekeyLegacyAccount(cfg, "prod", "real@x.com", "usr_1")
    expect(result).toBe(true)
    const prod = cfg.envs.prod!
    expect(prod.accounts["real@x.com"]).toMatchObject({ email: "real@x.com", user_id: "usr_1" })
    expect(prod.accounts["(default)"]).toBeUndefined()
    expect(prod.current_account).toBe("real@x.com")
  })

  it("is a no-op when email === '(default)'", () => {
    const cfg = legacyCfg()
    const result = rekeyLegacyAccount(cfg, "prod", "(default)", "usr_1")
    expect(result).toBe(false)
    expect(cfg.envs.prod!.accounts["(default)"]).toBeDefined()
    expect(cfg.envs.prod!.current_account).toBe("(default)")
  })

  it("is a no-op when there is no (default) placeholder", () => {
    const cfg: WspcConfig = {
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "existing@x.com",
          accounts: { "existing@x.com": { email: "existing@x.com", access_token: "at", refresh_token: "rt" } },
        },
      },
    }
    const result = rekeyLegacyAccount(cfg, "prod", "real@x.com", "usr_1")
    expect(result).toBe(false)
    expect(cfg.envs.prod!.accounts["existing@x.com"]).toBeDefined()
    expect(cfg.envs.prod!.accounts["real@x.com"]).toBeUndefined()
  })

  it("renames without setting user_id when userId arg is omitted", () => {
    const cfg = legacyCfg()
    const result = rekeyLegacyAccount(cfg, "prod", "real@x.com")
    expect(result).toBe(true)
    const account = cfg.envs.prod!.accounts["real@x.com"]
    expect(account).toBeDefined()
    expect(account!.email).toBe("real@x.com")
    expect(account!.user_id).toBeUndefined()
  })

  it("drops (default) placeholder without clobbering an already-real account", () => {
    const cfg: WspcConfig = {
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          client_id: "client_X",
          current_account: "real@x.com",
          accounts: {
            "(default)": { email: "(default)", access_token: "OLD", refresh_token: "rt_old" },
            "real@x.com": { email: "real@x.com", access_token: "FRESH", refresh_token: "rt_fresh" },
          },
        },
      },
    }
    const result = rekeyLegacyAccount(cfg, "prod", "real@x.com", "usr_1")
    expect(result).toBe(true)
    const prod = cfg.envs.prod!
    expect(prod.accounts["(default)"]).toBeUndefined()
    expect(prod.accounts["real@x.com"]?.access_token).toBe("FRESH")
    expect(Object.keys(prod.accounts)).toEqual(["real@x.com"])
  })
})

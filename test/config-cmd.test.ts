import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { setConfigKey } from "../src/handwritten/commands/config.js"

function cfg() {
  return {
    schema_version: 2 as const,
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        current_account: "a@x.com",
        accounts: { "a@x.com": { email: "a@x.com", access_token: "at", refresh_token: "rt" } },
      },
    },
  }
}

describe("setConfigKey", () => {
  it("sets actor on the active account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-cfg-set-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await setConfigKey(store, "actor", "agent")
    const c = await store.read()
    expect(c.envs.prod!.accounts["a@x.com"]!.actor).toBe("agent")
  })

  it("sets agent-label on the active account", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-cfg-label-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await setConfigKey(store, "agent-label", "bot-1")
    const c = await store.read()
    expect(c.envs.prod!.accounts["a@x.com"]!.agent_label).toBe("bot-1")
  })

  it("rejects an invalid actor value", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-cfg-bad-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await expect(setConfigKey(store, "actor", "robot")).rejects.toThrow(/actor must be/)
  })

  it("rejects an unknown key", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "wspc-cfg-unknown-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write(cfg())
    await expect(setConfigKey(store, "nope", "x")).rejects.toThrow(/unknown config key/)
  })
})

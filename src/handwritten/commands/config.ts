import { Command } from "commander"
import { ConfigStore } from "../config/index.js"

export const configCommand = new Command("config").description("Manage wspc local config")

configCommand
  .command("show")
  .description("Print current ~/.wspc/config.json (tokens redacted)")
  .action(async () => {
    const c = await new ConfigStore().read()
    const redacted = JSON.parse(JSON.stringify(c))
    for (const env of Object.values(redacted.envs ?? {}) as Record<string, unknown>[]) {
      if (env.refresh_token) env.refresh_token = "<redacted>"
      if (env.access_token) env.access_token = "<redacted>"
      if (env.api_key) env.api_key = "<redacted>"
    }
    process.stdout.write(JSON.stringify(redacted, null, 2) + "\n")
  })

configCommand
  .command("set <key> <value>")
  .description("Set a config field on current env (actor, agent-label, ...)")
  .action(async (key: string, value: string) => {
    const store = new ConfigStore()
    const c = await store.read()
    if (!c.current_env) throw new Error("no current env; run `wspc login` first")
    const env = c.envs[c.current_env]
    if (!env) throw new Error(`env ${c.current_env} missing`)
    switch (key) {
      case "actor":
        if (value !== "user" && value !== "agent") throw new Error("actor must be 'user' or 'agent'")
        env.actor = value
        break
      case "agent-label":
        env.agent_label = value
        break
      default:
        throw new Error(`unknown config key: ${key}`)
    }
    await store.write(c)
    process.stdout.write(`✓ set ${key}=${value}\n`)
  })

configCommand
  .command("use <env>")
  .description("Switch current_env")
  .action(async (env: string) => {
    const store = new ConfigStore()
    const c = await store.read()
    if (!c.envs[env]) throw new Error(`env "${env}" not found`)
    c.current_env = env
    await store.write(c)
    process.stdout.write(`✓ current_env=${env}\n`)
  })

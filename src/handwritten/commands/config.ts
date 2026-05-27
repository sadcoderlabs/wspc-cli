import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { render, registerRenderer } from "../output/render.js"
import { dim, green, table } from "../output/primitives.js"

export const configCommand = new Command("config").description("Manage wspc local config")

/**
 * Specific renderer for `config show`. The list-of-envs shape works fine
 * with the generic table renderer, but we want a leading ✓ column for the
 * current env that doesn't show up in JSON output — easier to do as a
 * dedicated renderer than to thread a "current" marker through format hints.
 */
interface ConfigShowPayload {
  current_env?: string
  envs: Array<{
    name: string
    api_base: string
    actor?: string
    auth: "api_key" | "oauth" | "none"
  }>
}

registerRenderer("config_show", (data) => {
  const d = data as ConfigShowPayload
  if (d.envs.length === 0) {
    process.stdout.write(dim('  no envs configured. run "wspc login".') + "\n")
    return
  }
  const headers = ["", "ENV", "API BASE", "ACTOR", "AUTH"]
  const rows = d.envs.map((e) => [
    e.name === d.current_env ? green("✓") : " ",
    e.name,
    e.api_base,
    e.actor ?? dim("—"),
    e.auth === "none" ? dim("none") : e.auth,
  ])
  process.stdout.write(table(headers, rows))
})

configCommand
  .command("show")
  .description("List configured envs (tokens redacted, current marked with ✓)")
  .action(async () => {
    const c = await new ConfigStore().read()
    const envs = Object.entries(c.envs ?? {}).map(([name, env]) => ({
      name,
      api_base: env.api_base,
      ...(env.actor !== undefined ? { actor: env.actor } : {}),
      auth: (env.api_key
        ? "api_key"
        : env.access_token
          ? "oauth"
          : "none") as "api_key" | "oauth" | "none",
    }))
    render(
      { kind: "config_show" },
      {
        ...(c.current_env !== undefined ? { current_env: c.current_env } : {}),
        envs,
      },
    )
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

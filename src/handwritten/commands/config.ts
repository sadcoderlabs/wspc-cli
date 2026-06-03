import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { resolveAccount } from "../auth/resolve-account.js"
import { render, registerRenderer } from "../output/render.js"
import { dim, green, table } from "../output/primitives.js"

export const configCommand = new Command("config").description("Manage wspc local config")

interface ConfigShowPayload {
  current_env?: string
  envs: Array<{
    name: string
    api_base: string
    active_account?: string
    accounts: number
    auth: "api_key" | "oauth" | "none"
  }>
}

registerRenderer("config_show", (data) => {
  const d = data as ConfigShowPayload
  if (d.envs.length === 0) {
    process.stdout.write(dim('  no envs configured. run "wspc login".') + "\n")
    return
  }
  const headers = ["", "ENV", "API BASE", "ACTIVE ACCOUNT", "ACCOUNTS", "AUTH"]
  const rows = d.envs.map((e) => [
    e.name === d.current_env ? green("✓") : " ",
    e.name,
    e.api_base,
    e.active_account ?? dim("—"),
    String(e.accounts),
    e.auth === "none" ? dim("none") : e.auth,
  ])
  process.stdout.write(table(headers, rows))
})

/** Set a config field on the active account of the current env. Exported for tests. */
export async function setConfigKey(store: ConfigStore, key: string, value: string): Promise<void> {
  const c = await store.read()
  const resolved = resolveAccount(c, { accountOverride: process.env.WSPC_ACCOUNT })
  const env = c.envs[resolved.envName]
  if (!env) throw new Error(`env "${resolved.envName}" not found`)
  const acct = env.accounts[resolved.email]
  if (!acct) throw new Error(`account "${resolved.email}" not found`)
  switch (key) {
    case "actor":
      if (value !== "user" && value !== "agent") throw new Error("actor must be 'user' or 'agent'")
      acct.actor = value
      break
    case "agent-label":
      acct.agent_label = value
      break
    default:
      throw new Error(`unknown config key: ${key}`)
  }
  await store.write(c)
}

configCommand
  .command("show")
  .description("List configured envs (tokens redacted, current marked with ✓)")
  .action(async () => {
    const c = await new ConfigStore().read()
    const envs = Object.entries(c.envs ?? {}).map(([name, env]) => {
      const active = env.current_account ? env.accounts?.[env.current_account] : undefined
      return {
        name,
        api_base: env.api_base,
        ...(env.current_account !== undefined ? { active_account: env.current_account } : {}),
        accounts: Object.keys(env.accounts ?? {}).length,
        auth: (active?.api_key
          ? "api_key"
          : active?.access_token
            ? "oauth"
            : "none") as "api_key" | "oauth" | "none",
      }
    })
    render(
      { kind: "config_show" },
      { ...(c.current_env !== undefined ? { current_env: c.current_env } : {}), envs },
    )
  })

configCommand
  .command("set <key> <value>")
  .description("Set a field on the active account (actor, agent-label, ...)")
  .action(async (key: string, value: string) => {
    await setConfigKey(new ConfigStore(), key, value)
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

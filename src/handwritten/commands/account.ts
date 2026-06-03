import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { render, registerRenderer } from "../output/render.js"
import { dim, green, table } from "../output/primitives.js"

export interface AccountRow {
  email: string
  user_id?: string
  actor?: "user" | "agent"
  auth: "oauth" | "api_key" | "none"
  active: boolean
}

export async function listAccounts(store: ConfigStore): Promise<AccountRow[]> {
  const c = await store.read()
  const envName = c.current_env
  if (!envName || !c.envs[envName]) return []
  const env = c.envs[envName]
  return Object.values(env.accounts ?? {}).map((a) => ({
    email: a.email,
    user_id: a.user_id,
    actor: a.actor,
    auth: a.api_key ? "api_key" : a.access_token ? "oauth" : "none",
    active: env.current_account === a.email,
  }))
}

export async function switchAccount(store: ConfigStore, email: string): Promise<void> {
  const c = await store.read()
  const envName = c.current_env
  if (!envName || !c.envs[envName]) throw new Error("no current env; run `wspc login` first")
  const env = c.envs[envName]
  if (!env.accounts?.[email]) {
    throw new Error(`no account '${email}' in env '${envName}'. Run \`wspc account ls\` or \`wspc login\`.`)
  }
  env.current_account = email
  await store.write(c)
}

registerRenderer("account_ls", (data) => {
  const rows = (data as { accounts: AccountRow[] }).accounts
  if (rows.length === 0) {
    process.stdout.write(dim('  no accounts. run "wspc login".') + "\n")
    return
  }
  const headers = ["", "EMAIL", "USER", "ACTOR", "AUTH"]
  const body = rows.map((r) => [
    r.active ? green("✓") : " ",
    r.email,
    r.user_id ?? dim("—"),
    r.actor ?? dim("—"),
    r.auth === "none" ? dim("none") : r.auth,
  ])
  process.stdout.write(table(headers, body))
})

export const accountCommand = new Command("account").description("Manage logged-in accounts")

accountCommand
  .command("ls")
  .description("List accounts in the current env (active marked with ✓)")
  .action(async () => {
    const accounts = await listAccounts(new ConfigStore())
    render({ kind: "account_ls" }, { accounts })
  })

accountCommand
  .command("switch <email>")
  .description("Set the active account for the current env")
  .action(async (email: string) => {
    await switchAccount(new ConfigStore(), email)
    process.stdout.write(`✓ active account is now ${email}\n`)
  })

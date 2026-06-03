import type { ConfigStore } from "../config/index.js"

export interface RunLogoutOptions {
  store: ConfigStore
  envName?: string
  email?: string
  all?: boolean
}

export interface RunLogoutResult {
  removed: string[]
  newActive?: string
}

/**
 * Remove account(s) from an env's `accounts` map.
 *   - all:true            → remove every account
 *   - email:"x@y"         → remove that specific account
 *   - neither             → remove the active account (or the sole one)
 * When the active account is removed and exactly one remains, it is promoted
 * to active; if more than one remains, active is cleared (requires switch).
 */
export async function runLogout(opts: RunLogoutOptions): Promise<RunLogoutResult> {
  const c = await opts.store.read()
  const envName = opts.envName ?? c.current_env
  if (!envName || !c.envs[envName]) return { removed: [] }
  const env = c.envs[envName]
  env.accounts ??= {}

  if (opts.all) {
    const removed = Object.keys(env.accounts)
    env.accounts = {}
    env.current_account = undefined
    await opts.store.write(c)
    return { removed }
  }

  const target =
    opts.email ??
    env.current_account ??
    (Object.keys(env.accounts).length === 1 ? Object.keys(env.accounts)[0] : undefined)

  if (!target || !env.accounts[target]) return { removed: [] }

  delete env.accounts[target]
  if (env.current_account === target) {
    const remaining = Object.keys(env.accounts)
    env.current_account = remaining.length === 1 ? remaining[0] : undefined
  }
  await opts.store.write(c)
  return { removed: [target], newActive: env.current_account }
}

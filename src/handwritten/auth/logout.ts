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
  let removed: string[] = []
  let newActive: string | undefined
  let removedSingleAccount = false

  await opts.store.update((c) => {
    const envName = opts.envName ?? c.current_env
    if (!envName || !c.envs[envName]) return
    const env = c.envs[envName]
    env.accounts ??= {}

    if (opts.all) {
      removed = Object.keys(env.accounts)
      env.accounts = {}
      env.current_account = undefined
      return
    }

    const target =
      opts.email ??
      env.current_account ??
      (Object.keys(env.accounts).length === 1 ? Object.keys(env.accounts)[0] : undefined)

    if (!target || !env.accounts[target]) return

    delete env.accounts[target]
    removed = [target]
    removedSingleAccount = true
    if (env.current_account === target) {
      const remaining = Object.keys(env.accounts)
      env.current_account = remaining.length === 1 ? remaining[0] : undefined
    }
    newActive = env.current_account
  })

  return removedSingleAccount ? { removed, newActive } : { removed }
}

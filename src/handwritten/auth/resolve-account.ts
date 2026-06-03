import type { AccountCreds, WspcConfig } from "../config/index.js"

export interface ResolvedAccount {
  envName: string
  apiBase: string
  clientId?: string
  email: string
  creds: AccountCreds
}

const NOT_LOGGED_IN = "not logged in: run `wspc login` first"

/**
 * Decide which account a command runs as, by precedence:
 *   1. opts.accountOverride  (--account flag / WSPC_ACCOUNT env)
 *   2. env.current_account   (interactive active account)
 *   3. the sole account, if exactly one exists
 *   4. error
 */
export function resolveAccount(
  config: WspcConfig,
  opts: { accountOverride?: string } = {},
): ResolvedAccount {
  const envName = config.current_env
  if (!envName || !config.envs[envName]) throw new Error(NOT_LOGGED_IN)
  const env = config.envs[envName]
  const accounts = env.accounts ?? {}
  const emails = Object.keys(accounts)

  let email: string | undefined
  const override = opts.accountOverride
  if (override) {
    if (!accounts[override]) {
      throw new Error(
        `no account '${override}' in env '${envName}'. Run \`wspc account ls\` or \`wspc login\`.`,
      )
    }
    email = override
  } else if (env.current_account && accounts[env.current_account]) {
    email = env.current_account
  } else if (emails.length === 1) {
    email = emails[0]
  } else if (emails.length === 0) {
    throw new Error(NOT_LOGGED_IN)
  } else {
    throw new Error(
      `multiple accounts in env '${envName}'; specify --account <email> or run \`wspc account switch <email>\`.`,
    )
  }

  const creds = accounts[email]
  if (!creds.api_key && !(creds.access_token && creds.refresh_token)) {
    throw new Error(NOT_LOGGED_IN)
  }
  return { envName, apiBase: env.api_base, clientId: env.client_id, email, creds }
}

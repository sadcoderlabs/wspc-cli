import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const LEGACY_ACCOUNT_KEY = "(default)"

export interface AccountCreds {
  email: string
  user_id?: string
  refresh_token?: string
  access_token?: string
  access_token_expires_at?: number
  api_key?: string // legacy / escape hatch
  actor?: "user" | "agent"
  agent_label?: string
}

export interface EnvConfig {
  api_base: string
  // RFC 7591 dynamically registered OAuth public client — server-level app
  // identity, shared by every account on this env. Kept across logout.
  client_id?: string
  current_account?: string // email of the active account in this env
  accounts: Record<string, AccountCreds>
}

export interface WspcConfig {
  schema_version?: 2
  current_env?: string
  envs: Record<string, EnvConfig>
}

const DEFAULT_DIR = join(homedir(), ".wspc")

// Fields that lived at env level in v1 and now belong on an account.
const V1_CRED_KEYS = [
  "refresh_token",
  "access_token",
  "access_token_expires_at",
  "api_key",
  "actor",
  "agent_label",
] as const

function migrateEnv(raw: Record<string, unknown>): EnvConfig {
  const api_base = typeof raw.api_base === "string" ? raw.api_base : ""
  const env: EnvConfig = { api_base, accounts: {} }
  if (typeof raw.client_id === "string") env.client_id = raw.client_id

  // Already v2: trust its accounts/current_account as-is.
  if (raw.accounts && typeof raw.accounts === "object") {
    env.accounts = raw.accounts as Record<string, AccountCreds>
    if (typeof raw.current_account === "string") env.current_account = raw.current_account
    return env
  }

  // v1: fold any env-level creds into accounts[(default)].
  const hasCreds = V1_CRED_KEYS.some((k) => raw[k] !== undefined)
  if (hasCreds) {
    const creds: AccountCreds = { email: LEGACY_ACCOUNT_KEY }
    for (const k of V1_CRED_KEYS) {
      if (raw[k] !== undefined) (creds as unknown as Record<string, unknown>)[k] = raw[k]
    }
    env.accounts[LEGACY_ACCOUNT_KEY] = creds
    env.current_account = LEGACY_ACCOUNT_KEY
  }
  return env
}

function normalize(parsed: unknown): WspcConfig {
  if (typeof parsed !== "object" || parsed === null) return { envs: {} }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.envs !== "object" || obj.envs === null) return { envs: {} }
  const envs: Record<string, EnvConfig> = {}
  for (const [name, rawEnv] of Object.entries(obj.envs as Record<string, unknown>)) {
    if (typeof rawEnv === "object" && rawEnv !== null) {
      envs[name] = migrateEnv(rawEnv as Record<string, unknown>)
    }
  }
  const out: WspcConfig = { schema_version: 2, envs }
  if (typeof obj.current_env === "string") out.current_env = obj.current_env
  return out
}

/**
 * Rename the migration placeholder account `(default)` to its real email once
 * /auth/me resolves it. Returns true if a rename happened. No-op otherwise.
 */
export function rekeyLegacyAccount(
  config: WspcConfig,
  envName: string,
  email: string,
  userId?: string,
): boolean {
  if (email === LEGACY_ACCOUNT_KEY) return false
  const env = config.envs[envName]
  const legacy = env?.accounts?.[LEGACY_ACCOUNT_KEY]
  if (!env || !legacy) return false
  delete env.accounts[LEGACY_ACCOUNT_KEY]
  // Don't clobber an already-real account that shares this email (e.g. a login
  // created it before the placeholder was cleaned up) — just drop the placeholder.
  if (!env.accounts[email]) {
    env.accounts[email] = { ...legacy, email, ...(userId ? { user_id: userId } : {}) }
  }
  if (env.current_account === LEGACY_ACCOUNT_KEY) env.current_account = email
  return true
}

export class ConfigStore {
  private readonly configDir: string
  private readonly configFile: string

  constructor(opts: { configDir?: string } = {}) {
    this.configDir = opts.configDir ?? DEFAULT_DIR
    this.configFile = join(this.configDir, "config.json")
  }

  async read(): Promise<WspcConfig> {
    try {
      const buf = await fs.readFile(this.configFile, "utf8")
      return normalize(JSON.parse(buf))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { envs: {} }
      throw e
    }
  }

  async write(config: WspcConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") {
      await fs.chmod(this.configDir, 0o700).catch(() => {})
    }
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  }

  async currentEnv(): Promise<{ name: string; config: EnvConfig } | undefined> {
    const c = await this.read()
    const name = c.current_env
    if (!name) return undefined
    const env = c.envs[name]
    if (!env) return undefined
    return { name, config: env }
  }
}

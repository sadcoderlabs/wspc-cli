import type { ConfigStore, EnvConfig, WspcConfig } from "../config/index.js"
import { LEGACY_ACCOUNT_KEY } from "../config/index.js"
import { runDeviceFlow, type DeviceFlowResult, type DeviceFlowPrompt } from "./device-flow.js"
import { ensureClientId } from "./client-registration.js"
import { fetchMe as defaultFetchMe } from "./fetch-me.js"
import { bold, cyan, dim, green } from "../output/primitives.js"

export interface LoginOutput {
  write(line: string): void
  writeJson(event: Record<string, unknown>): void
}

export interface RunLoginOptions {
  store: ConfigStore
  baseUrl: string
  output: LoginOutput
  envName?: string
  clientId?: string
  ensureClient?: (envName: string) => Promise<string>
  deviceFlow?: (opts: {
    baseUrl: string
    clientId: string
    store?: ConfigStore
    envName?: string
    onPrompt: (p: unknown) => void
  }) => Promise<DeviceFlowResult>
  now?: () => number
  apiKey?: string
  fetchMe?: (opts: {
    baseUrl: string
    token: string
    store?: ConfigStore
    envName?: string
  }) => Promise<{ user_id: string; email: string }>
}

/** Human-friendly device-flow panel. Leads with the prefilled link
 * (verification_uri_complete) so most users click once; keeps the bare URL +
 * code as a manual fallback. Colours degrade to plain text under NO_COLOR /
 * non-TTY via the primitives. */
function renderDevicePrompt(prompt: DeviceFlowPrompt): string {
  const mins = Math.max(1, Math.round((prompt.expires_in ?? 0) / 60))
  const lines = ["", `  ${bold("wspc login")}`, ""]
  if (prompt.verification_uri_complete) {
    lines.push(`  ${dim("Open this link to sign in (code already filled in):")}`)
    lines.push(`    ${cyan(prompt.verification_uri_complete)}`)
    lines.push("")
    lines.push(`  ${dim(`Or go to ${prompt.verification_uri} and enter:`)}`)
    lines.push(`    ${bold(prompt.user_code)}`)
  } else {
    lines.push(`  ${dim(`Go to ${prompt.verification_uri} and enter:`)}`)
    lines.push(`    ${bold(prompt.user_code)}`)
  }
  lines.push("")
  lines.push(`  ${dim(`Code expires in ${mins}m · waiting for approval…`)}`)
  lines.push("")
  return lines.join("\n")
}

function getOrCreateEnv(c: WspcConfig, envName: string, apiBase: string): EnvConfig {
  const existing = c.envs[envName]
  if (existing) {
    existing.api_base = apiBase
    existing.accounts ??= {}
    return existing
  }
  const fresh: EnvConfig = { api_base: apiBase, accounts: {} }
  c.envs[envName] = fresh
  return fresh
}

export async function runLogin(opts: RunLoginOptions): Promise<void> {
  const envName = opts.envName ?? "prod"
  const now = opts.now ?? Date.now
  const me =
    opts.fetchMe ??
    ((o: { baseUrl: string; token: string; store?: ConfigStore; envName?: string }) =>
      defaultFetchMe(o))

  if (opts.apiKey) {
    const initial = await opts.store.read()
    getOrCreateEnv(initial, envName, opts.baseUrl)
    initial.current_env = envName
    await opts.store.write(initial)

    const who = await me({
      baseUrl: opts.baseUrl,
      token: opts.apiKey,
      store: opts.store,
      envName,
    })
    const c = await opts.store.read()
    const env = getOrCreateEnv(c, envName, opts.baseUrl)
    const prev = env.accounts[who.email] ?? { email: who.email }
    const acct = (env.accounts[who.email] = {
      ...prev,
      email: who.email,
      user_id: who.user_id,
      api_key: opts.apiKey,
    })
    // api-key login is mutually exclusive with stored OAuth tokens.
    delete acct.refresh_token
    delete acct.access_token
    delete acct.access_token_expires_at
    env.current_account = who.email
    if (who.email !== LEGACY_ACCOUNT_KEY) delete env.accounts[LEGACY_ACCOUNT_KEY]
    c.current_env = envName
    await opts.store.write(c)
    opts.output.write(`${green("✓")} logged in (api key) as ${bold(who.email)} ${dim(`→ env "${envName}"`)}`)
    return
  }

  const ensureClient =
    opts.ensureClient ??
    ((env: string) => ensureClientId({ store: opts.store, envName: env, baseUrl: opts.baseUrl }))
  const clientId = opts.clientId ?? (await ensureClient(envName))
  const flow = opts.deviceFlow ?? runDeviceFlow

  const result = await flow({
    baseUrl: opts.baseUrl,
    clientId,
    store: opts.store,
    envName,
    onPrompt: (p) => {
      const prompt = p as DeviceFlowPrompt
      opts.output.writeJson({ event: "device_code_issued", ...prompt })
      opts.output.write(renderDevicePrompt(prompt))
    },
  })

  const who = await me({
    baseUrl: opts.baseUrl,
    token: result.access_token,
    store: opts.store,
    envName,
  })

  // Re-read: ensureClient may have written client_id while we ran the flow.
  const c = await opts.store.read()
  const env = getOrCreateEnv(c, envName, opts.baseUrl)
  const prev = env.accounts[who.email] ?? { email: who.email }
  const acct = (env.accounts[who.email] = {
    ...prev,
    email: who.email,
    user_id: who.user_id,
    refresh_token: result.refresh_token,
    access_token: result.access_token,
    access_token_expires_at: now() + result.expires_in * 1000,
  })
  // login is OAuth now — drop any stale api_key on this account.
  delete acct.api_key
  env.current_account = who.email
  if (who.email !== LEGACY_ACCOUNT_KEY) delete env.accounts[LEGACY_ACCOUNT_KEY]
  c.current_env = envName
  await opts.store.write(c)
  opts.output.writeJson({ event: "login_success", email: who.email })
  opts.output.write(`${green("✓")} logged in as ${bold(who.email)} ${dim(`→ env "${envName}"`)}`)
}

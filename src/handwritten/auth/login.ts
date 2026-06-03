import type { ConfigStore, EnvConfig, WspcConfig } from "../config/index.js"
import { runDeviceFlow, type DeviceFlowResult } from "./device-flow.js"
import { ensureClientId } from "./client-registration.js"
import { fetchMe as defaultFetchMe } from "./fetch-me.js"

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
    onPrompt: (p: unknown) => void
  }) => Promise<DeviceFlowResult>
  now?: () => number
  apiKey?: string
  fetchMe?: (opts: { baseUrl: string; token: string }) => Promise<{ user_id: string; email: string }>
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
  const me = opts.fetchMe ?? ((o: { baseUrl: string; token: string }) => defaultFetchMe(o))

  if (opts.apiKey) {
    const who = await me({ baseUrl: opts.baseUrl, token: opts.apiKey })
    const c = await opts.store.read()
    const env = getOrCreateEnv(c, envName, opts.baseUrl)
    const prev = env.accounts[who.email] ?? { email: who.email }
    env.accounts[who.email] = {
      ...prev,
      email: who.email,
      user_id: who.user_id,
      api_key: opts.apiKey,
    }
    // api-key login is mutually exclusive with stored OAuth tokens.
    delete env.accounts[who.email].refresh_token
    delete env.accounts[who.email].access_token
    delete env.accounts[who.email].access_token_expires_at
    env.current_account = who.email
    c.current_env = envName
    await opts.store.write(c)
    opts.output.write(`✓ logged in (api key) as ${who.email} → env "${envName}"`)
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
    onPrompt: (p) => {
      const prompt = p as { verification_uri: string; user_code: string; expires_in: number }
      opts.output.writeJson({ event: "device_code_issued", ...prompt })
      opts.output.write(`\n=== wspc login ===`)
      opts.output.write(`verification_uri: ${prompt.verification_uri}`)
      opts.output.write(`user_code: ${prompt.user_code}`)
      opts.output.write(`expires_in: ${prompt.expires_in}`)
      opts.output.write(`=== waiting for approval ===\n`)
    },
  })

  const who = await me({ baseUrl: opts.baseUrl, token: result.access_token })

  // Re-read: ensureClient may have written client_id while we ran the flow.
  const c = await opts.store.read()
  const env = getOrCreateEnv(c, envName, opts.baseUrl)
  const prev = env.accounts[who.email] ?? { email: who.email }
  env.accounts[who.email] = {
    ...prev,
    email: who.email,
    user_id: who.user_id,
    refresh_token: result.refresh_token,
    access_token: result.access_token,
    access_token_expires_at: now() + result.expires_in * 1000,
  }
  // login is OAuth now — drop any stale api_key on this account.
  delete env.accounts[who.email].api_key
  env.current_account = who.email
  c.current_env = envName
  await opts.store.write(c)
  opts.output.writeJson({ event: "login_success", email: who.email })
  opts.output.write(`✓ logged in as ${who.email} → env "${envName}"`)
}

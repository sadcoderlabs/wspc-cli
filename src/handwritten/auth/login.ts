import type { ConfigStore } from "../config/index.js"
import { runDeviceFlow, type DeviceFlowResult } from "./device-flow.js"
import { ensureClientId } from "./client-registration.js"

export interface LoginOutput {
  write(line: string): void
  writeJson(event: Record<string, unknown>): void
}

export interface RunLoginOptions {
  store: ConfigStore
  baseUrl: string
  output: LoginOutput
  envName?: string
  // Device flow path:
  /** Skip auto-registration and use this exact client_id instead. */
  clientId?: string
  /** Override the default RFC 7591 register step (tests). */
  ensureClient?: (envName: string) => Promise<string>
  deviceFlow?: (opts: { baseUrl: string; clientId: string; onPrompt: (p: unknown) => void }) => Promise<DeviceFlowResult>
  now?: () => number
  // API key escape hatch:
  apiKey?: string
}

export async function runLogin(opts: RunLoginOptions): Promise<void> {
  const envName = opts.envName ?? "prod"
  const now = opts.now ?? Date.now
  const c = await opts.store.read()

  if (opts.apiKey) {
    c.current_env = envName
    c.envs[envName] = { ...(c.envs[envName] ?? {}), api_base: opts.baseUrl, api_key: opts.apiKey }
    await opts.store.write(c)
    opts.output.write(`✓ logged in (api key) → env "${envName}"`)
    return
  }

  // Resolve a client_id: explicit override wins, then registered-on-disk,
  // otherwise auto-register via RFC 7591 and persist.
  const ensureClient =
    opts.ensureClient ?? ((env: string) => ensureClientId({ store: opts.store, envName: env, baseUrl: opts.baseUrl }))
  const clientId = opts.clientId ?? (await ensureClient(envName))
  // NB: default flow MUST pass o.onPrompt through verbatim. Earlier
  // implementation did `...o, onPrompt: () => {}` which silently swallowed
  // the real callback and left users staring at an empty terminal forever.
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

  // Re-read: ensureClient may have written a fresh client_id to disk while
  // we held the stale `c` from line 29. Without re-reading we'd clobber it.
  const cFinal = await opts.store.read()
  cFinal.current_env = envName
  cFinal.envs[envName] = {
    ...(cFinal.envs[envName] ?? {}),
    api_base: opts.baseUrl,
    refresh_token: result.refresh_token,
    access_token: result.access_token,
    access_token_expires_at: now() + result.expires_in * 1000,
  }
  // Strip any leftover api_key (login is OAuth now)
  const env = cFinal.envs[envName] as unknown as Record<string, unknown>
  if (env && "api_key" in env) delete env.api_key
  await opts.store.write(cFinal)
  opts.output.writeJson({ event: "login_success" })
  opts.output.write(`✓ logged in → env "${envName}"`)
}

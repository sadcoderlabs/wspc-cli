import type { ConfigStore } from "../config/index.js"
import { runDeviceFlow, type DeviceFlowResult } from "./device-flow.js"

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
  clientId?: string
  deviceFlow?: (opts: { baseUrl: string; clientId: string; onPrompt: (p: unknown) => void }) => Promise<DeviceFlowResult>
  now?: () => number
  // API key escape hatch:
  apiKey?: string
}

const DEFAULT_CLIENT_ID = "oac_wspc_cli"

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

  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID
  const flow = opts.deviceFlow ?? ((o) => runDeviceFlow({ ...o, onPrompt: () => {} }))

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

  c.current_env = envName
  c.envs[envName] = {
    ...(c.envs[envName] ?? {}),
    api_base: opts.baseUrl,
    refresh_token: result.refresh_token,
    access_token: result.access_token,
    access_token_expires_at: now() + result.expires_in * 1000,
  }
  // Strip any leftover api_key (login is OAuth now)
  const env = c.envs[envName] as unknown as Record<string, unknown>
  if (env && "api_key" in env) delete env.api_key
  await opts.store.write(c)
  opts.output.writeJson({ event: "login_success" })
  opts.output.write(`✓ logged in → env "${envName}"`)
}

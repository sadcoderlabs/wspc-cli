import type { ConfigStore } from "../config/index.js"

const DEFAULT_CLIENT_NAME = "wspc CLI"
// Device flow doesn't use redirect, but RFC 7591 requires a value.
const DEFAULT_REDIRECT_URI = "http://localhost"

export interface EnsureClientIdOptions {
  store: ConfigStore
  envName: string
  baseUrl: string
  fetchImpl?: typeof fetch
  clientName?: string
}

interface RegisterResponse {
  client_id: string
}

/**
 * Returns the OAuth `client_id` stored under `envName`, registering a new
 * public client via RFC 7591 `/auth/oauth/register` and persisting the
 * resulting id if none exists yet. Re-running is idempotent: stored id wins.
 */
export async function ensureClientId(opts: EnsureClientIdOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const c = await opts.store.read()
  const existing = c.envs[opts.envName]?.client_id
  if (existing) return existing

  const res = await fetchImpl(`${opts.baseUrl}/auth/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: opts.clientName ?? DEFAULT_CLIENT_NAME,
      redirect_uris: [DEFAULT_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
    }),
  })
  if (!res.ok) {
    throw new Error(`client_registration_failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as RegisterResponse
  if (!body.client_id) throw new Error("client_registration_failed: missing client_id in response")

  // Re-read in case other fields were updated between read and now.
  const fresh = await opts.store.read()
  const env = fresh.envs[opts.envName] ?? { api_base: opts.baseUrl, accounts: {} }
  env.client_id = body.client_id
  fresh.envs[opts.envName] = env
  await opts.store.write(fresh)
  return body.client_id
}

import type { ConfigStore } from "../config/index.js"
import { createConsistencyFetch } from "./consistency-fetch.js"

export interface MeResult {
  user_id: string
  email: string
}

/**
 * GET /auth/me with a bearer token (OAuth access token OR api key). Used at
 * login time to discover the account's email, which is the config map key.
 */
export async function fetchMe(opts: {
  baseUrl: string
  token: string
  store?: ConfigStore
  envName?: string
  fetchImpl?: typeof fetch
}): Promise<MeResult> {
  const f =
    opts.store && opts.envName
      ? createConsistencyFetch({
          store: opts.store,
          envName: opts.envName,
          apiBase: opts.baseUrl,
          fetchImpl: opts.fetchImpl,
        })
      : (opts.fetchImpl ?? fetch)
  const res = await f(`${opts.baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${opts.token}` },
  })
  if (!res.ok) throw new Error(`auth_me_failed: HTTP ${res.status}`)
  const body = (await res.json().catch(() => ({}))) as { user_id?: string; email?: string }
  if (!body.user_id || !body.email) {
    throw new Error("auth_me_failed: missing user_id/email in response")
  }
  return { user_id: body.user_id, email: body.email }
}

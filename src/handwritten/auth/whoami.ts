import type { ConfigStore } from "../config/index.js"

export interface WhoamiUser {
  user_id: string
  email: string
  display_name?: string
}

export type WhoamiResult =
  | { status: "logged_out" }
  | { status: "logged_in"; user: WhoamiUser }

export async function runWhoami(opts: {
  store: ConfigStore
  fetchImpl?: typeof fetch
}): Promise<WhoamiResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const current = await opts.store.currentEnv()
  if (!current) return { status: "logged_out" }
  const env = current.config
  const token = env.access_token ?? env.api_key
  if (!token) return { status: "logged_out" }
  const res = await fetchImpl(`${env.api_base}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 401) return { status: "logged_out" }
  if (!res.ok) throw new Error(`whoami_failed: HTTP ${res.status}`)
  // Server (GetMeResponse) returns { user_id, email, display_name?, api_key_id? }.
  const body = (await res.json()) as {
    user_id: string
    email: string
    display_name?: string
  }
  return {
    status: "logged_in",
    user: {
      user_id: body.user_id,
      email: body.email,
      ...(body.display_name !== undefined ? { display_name: body.display_name } : {}),
    },
  }
}

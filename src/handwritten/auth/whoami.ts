import type { ConfigStore } from "../config/index.js"

export type WhoamiResult =
  | { status: "logged_out" }
  | { status: "logged_in"; user: { id: string; email: string } }

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
  const body = (await res.json()) as { id: string; email: string }
  return { status: "logged_in", user: { id: body.id, email: body.email } }
}

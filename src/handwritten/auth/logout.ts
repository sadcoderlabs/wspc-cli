import type { ConfigStore } from "../config/index.js"

export async function runLogout(opts: { store: ConfigStore; envName?: string }): Promise<void> {
  const envName = opts.envName
  const c = await opts.store.read()
  const targetEnv = envName ?? c.current_env
  if (!targetEnv || !c.envs[targetEnv]) return
  const env = c.envs[targetEnv]
  delete env.refresh_token
  delete env.access_token
  delete env.access_token_expires_at
  delete env.api_key
  await opts.store.write(c)
}

import { ConfigStore } from "../config/index.js"
import { createClient, createConfig } from "../../generated/sdk/client/index.js"
import { createAuthInterceptor } from "./sdk-auth.js"

export interface AuthedFetch {
  fetch: typeof fetch
  baseUrl: string
}

export interface LoadedClient {
  _rawClient: ReturnType<typeof createClient>
}

export async function loadSdkClient(opts: { store?: ConfigStore } = {}): Promise<LoadedClient> {
  const store = opts.store ?? new ConfigStore()
  const current = await store.currentEnv()
  if (!current) {
    throw new Error("not logged in: run `wspc login` first")
  }

  const env = current.config

  if (!env.api_key && !(env.access_token && env.refresh_token)) {
    throw new Error("not logged in: run `wspc login` first")
  }

  let interceptor: ReturnType<typeof createAuthInterceptor>

  if (env.api_key) {
    interceptor = createAuthInterceptor({ apiKey: env.api_key })
  } else {
    // OAuth mode — access_token and refresh_token are guaranteed present here
    if (!env.client_id) {
      throw new Error(
        "config has OAuth tokens but no client_id — run `wspc logout && wspc login` to re-register",
      )
    }
    interceptor = createAuthInterceptor({
      accessToken: env.access_token!,
      refreshToken: env.refresh_token!,
      baseUrl: env.api_base,
      clientId: env.client_id,
      onTokenRefresh: async ({ accessToken, refreshToken, expiresAt }) => {
        const cfg = await store.read()
        const e = cfg.envs[current.name]
        if (!e) return
        e.access_token = accessToken
        e.refresh_token = refreshToken
        e.access_token_expires_at = expiresAt
        await store.write(cfg)
      },
    })
  }

  const rawClient = createClient(
    createConfig({
      baseUrl: env.api_base,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        interceptor.execute(new Request(input as RequestInfo, init))) as typeof fetch,
    }),
  )

  return { _rawClient: rawClient }
}

export async function loadAuthedFetch(opts: { store?: ConfigStore } = {}): Promise<AuthedFetch> {
  const store = opts.store ?? new ConfigStore()
  const current = await store.currentEnv()
  if (!current) throw new Error("not logged in: run `wspc login` first")
  const env = current.config
  if (!env.api_key && !(env.access_token && env.refresh_token)) {
    throw new Error("not logged in: run `wspc login` first")
  }

  let interceptor: ReturnType<typeof createAuthInterceptor>
  if (env.api_key) {
    interceptor = createAuthInterceptor({ apiKey: env.api_key })
  } else {
    if (!env.client_id) {
      throw new Error(
        "config has OAuth tokens but no client_id — run `wspc logout && wspc login` to re-register",
      )
    }
    interceptor = createAuthInterceptor({
      accessToken: env.access_token!,
      refreshToken: env.refresh_token!,
      baseUrl: env.api_base,
      clientId: env.client_id,
      onTokenRefresh: async ({ accessToken, refreshToken, expiresAt }) => {
        const cfg = await store.read()
        const e = cfg.envs[current.name]
        if (!e) return
        e.access_token = accessToken
        e.refresh_token = refreshToken
        e.access_token_expires_at = expiresAt
        await store.write(cfg)
      },
    })
  }

  const authedFetch: typeof fetch = (input, init) =>
    interceptor.execute(new Request(input as RequestInfo, init))

  return { fetch: authedFetch, baseUrl: env.api_base }
}

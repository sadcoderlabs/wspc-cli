import { ConfigStore } from "../config/index.js"
import { createClient, createConfig } from "../../generated/sdk/client/index.js"
import { createConsistencyFetch } from "./consistency-fetch.js"
import { createAuthInterceptor } from "./sdk-auth.js"
import { resolveAccount } from "./resolve-account.js"

export interface AuthedFetch {
  fetch: typeof fetch
  baseUrl: string
}

export interface LoadedClient {
  _rawClient: ReturnType<typeof createClient>
}

function buildInterceptor(
  store: ConfigStore,
  resolved: ReturnType<typeof resolveAccount>,
  fetchImpl: typeof fetch,
): ReturnType<typeof createAuthInterceptor> {
  const { envName, apiBase, clientId, email, creds } = resolved
  if (creds.api_key) {
    return createAuthInterceptor({ apiKey: creds.api_key, fetchImpl })
  }
  if (!clientId) {
    throw new Error(
      "config has OAuth tokens but no client_id — run `wspc logout && wspc login` to re-register",
    )
  }
  return createAuthInterceptor({
    accessToken: creds.access_token!,
    refreshToken: creds.refresh_token!,
    baseUrl: apiBase,
    clientId,
    fetchImpl,
    onTokenRefresh: async ({ accessToken, refreshToken, expiresAt }) => {
      const cfg = await store.read()
      const a = cfg.envs[envName]?.accounts?.[email]
      if (!a) return
      a.access_token = accessToken
      a.refresh_token = refreshToken
      a.access_token_expires_at = expiresAt
      await store.write(cfg)
    },
  })
}

export async function loadSdkClient(
  opts: { store?: ConfigStore; fetchImpl?: typeof fetch } = {},
): Promise<LoadedClient> {
  const store = opts.store ?? new ConfigStore()
  const config = await store.read()
  const resolved = resolveAccount(config, { accountOverride: process.env.WSPC_ACCOUNT })
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: resolved.envName,
    apiBase: resolved.apiBase,
    fetchImpl: opts.fetchImpl,
  })
  const interceptor = buildInterceptor(store, resolved, consistencyFetch)

  const rawClient = createClient(
    createConfig({
      baseUrl: resolved.apiBase,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        interceptor.execute(new Request(input as RequestInfo, init))) as typeof fetch,
    }),
  )
  return { _rawClient: rawClient }
}

export async function loadAuthedFetch(
  opts: { store?: ConfigStore; fetchImpl?: typeof fetch } = {},
): Promise<AuthedFetch> {
  const store = opts.store ?? new ConfigStore()
  const config = await store.read()
  const resolved = resolveAccount(config, { accountOverride: process.env.WSPC_ACCOUNT })
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: resolved.envName,
    apiBase: resolved.apiBase,
    fetchImpl: opts.fetchImpl,
  })
  const interceptor = buildInterceptor(store, resolved, consistencyFetch)

  const authedFetch: typeof fetch = (input, init) =>
    interceptor.execute(new Request(input as RequestInfo, init))
  return { fetch: authedFetch, baseUrl: resolved.apiBase }
}

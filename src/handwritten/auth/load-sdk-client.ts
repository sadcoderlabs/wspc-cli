import { ConfigStore } from "../config/index.js"
import { createClient, createConfig } from "../../generated/sdk/client/index.js"
import { createConsistencyFetch } from "./consistency-fetch.js"
import { createAuthInterceptor } from "./sdk-auth.js"
import { resolveAccount } from "./resolve-account.js"

export interface AuthedFetch {
  fetch: typeof globalThis.fetch
  baseUrl: string
}

export interface RealtimeAuthHeaders {
  baseUrl: string
  headers: Headers
}

export interface LoadedClient {
  _rawClient: ReturnType<typeof createClient>
}

export interface LoadedClientWithAuthedFetch extends LoadedClient, AuthedFetch {}

interface LoadedClientParts extends LoadedClientWithAuthedFetch {
  authInterceptor: ReturnType<typeof createAuthInterceptor>
}

function buildInterceptor(
  store: ConfigStore,
  resolved: ReturnType<typeof resolveAccount>,
  fetchImpl: typeof globalThis.fetch,
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
      await store.update((cfg) => {
        const a = cfg.envs[envName]?.accounts?.[email]
        if (!a) return
        a.access_token = accessToken
        a.refresh_token = refreshToken
        a.access_token_expires_at = expiresAt
      })
    },
  })
}

export async function loadSdkClient(
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<LoadedClient> {
  const { _rawClient } = await loadClientParts(opts)
  return { _rawClient }
}

export async function loadAuthedFetch(
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<AuthedFetch> {
  const { fetch, baseUrl } = await loadClientParts(opts)
  return { fetch, baseUrl }
}

export async function loadRealtimeAuthHeaders(
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<RealtimeAuthHeaders> {
  const { baseUrl, authInterceptor } = await loadClientParts(opts)
  const request = await authInterceptor.onRequest(new Request(baseUrl))
  return { baseUrl, headers: request.headers }
}

export async function loadSdkClientWithAuthedFetch(
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<LoadedClientWithAuthedFetch> {
  const { _rawClient, fetch, baseUrl } = await loadClientParts(opts)
  return { _rawClient, fetch, baseUrl }
}

async function loadClientParts(
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<LoadedClientParts> {
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
  const authedFetch: typeof globalThis.fetch = (input, init) =>
    interceptor.execute(new Request(input as RequestInfo, init))

  const rawClient = createClient(
    createConfig({
      baseUrl: resolved.apiBase,
      fetch: authedFetch,
    }),
  )
  return { _rawClient: rawClient, fetch: authedFetch, baseUrl: resolved.apiBase, authInterceptor: interceptor }
}

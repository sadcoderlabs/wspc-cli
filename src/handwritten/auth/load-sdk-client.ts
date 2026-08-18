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
    expiresAt: creds.access_token_expires_at,
    baseUrl: apiBase,
    clientId,
    fetchImpl,
    // Every command builds its own interceptor, and long-running ones (`drive
    // watch`) rebuild theirs per reconnect. Re-reading the config right before a
    // refresh keeps a second interceptor — in this process or another `wspc` —
    // from presenting a refresh token the first one has already rotated away.
    loadPersisted: async () => {
      const cfg = await store.read()
      const a = cfg.envs[envName]?.accounts?.[email]
      if (!a?.access_token || !a.refresh_token) return undefined
      return {
        accessToken: a.access_token,
        refreshToken: a.refresh_token,
        expiresAt: a.access_token_expires_at,
      }
    },
    onTokenRefresh: async ({ accessToken, refreshToken, expiresAt }) => {
      let saved = false
      await store.update((cfg) => {
        const a = cfg.envs[envName]?.accounts?.[email]
        if (!a) return
        a.access_token = accessToken
        a.refresh_token = refreshToken
        a.access_token_expires_at = expiresAt
        saved = true
      })
      // Dropping a rotation on the floor is worse than it looks: the server has
      // already invalidated the token we still hold, so the next refresh reads
      // as reuse and revokes the whole family. Say so rather than skip quietly.
      if (!saved) {
        process.stderr.write(
          `wspc: token rotated but not saved: no account '${email}' in env '${envName}'; ` +
            "the next refresh will present a superseded token and may sign you out\n",
        )
      }
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
  opts: { store?: ConfigStore; fetchImpl?: typeof globalThis.fetch; verifyPath?: string } = {},
): Promise<RealtimeAuthHeaders> {
  const { baseUrl, authInterceptor } = await loadClientParts(opts)
  const verifyUrl = new URL(opts.verifyPath ?? "/auth/me", `${baseUrl.replace(/\/$/, "")}/`)
  const verifyResponse = await authInterceptor.execute(new Request(verifyUrl))
  if (!verifyResponse.ok) {
    throw new Error(`realtime auth failed: HTTP ${verifyResponse.status}`)
  }
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

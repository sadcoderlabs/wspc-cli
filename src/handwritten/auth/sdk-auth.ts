import { WspcAuthExpiredError } from "../../index.js"
import { VERSION } from "../../version.js"

// Sent on every request + the refresh call so server logs can attribute a
// refresh/verify outcome to a specific CLI version.
const USER_AGENT = `@wspc/cli/${VERSION}`

export interface PersistedTokens {
  accessToken: string
  refreshToken: string
  expiresAt?: number
}

export type AuthMode =
  | { apiKey: string; fetchImpl?: typeof fetch }
  | {
      accessToken: string
      refreshToken: string
      // Unix ms when the access token expires, if known. Lets us refresh
      // proactively instead of spending a guaranteed 401 on an expired token.
      expiresAt?: number
      baseUrl: string
      clientId: string
      onTokenRefresh: (next: { accessToken: string; refreshToken: string; expiresAt: number }) => void | Promise<void>
      // Re-read the tokens from wherever they are persisted. Refresh tokens are
      // single-use: another process (or another interceptor in this one) may
      // have rotated ours since we cached it, and presenting the superseded copy
      // is what the server's reuse detection revokes the whole family for.
      // Called immediately before every refresh; omit for in-memory-only use.
      loadPersisted?: () => Promise<PersistedTokens | undefined>
      fetchImpl?: typeof fetch
      now?: () => number
    }

export interface AuthInterceptor {
  onRequest(req: Request): Promise<Request>
  execute(req: Request): Promise<Response>
}

// Surface the server's OAuth error code on a failed refresh. The server maps
// reuse/expired/revoked all to `invalid_grant`, so we can't tell them apart
// here — but echoing the code still beats a blank message when diagnosing.
async function expiredMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: string; error_description?: string }
    if (!body.error) return undefined
    const detail = body.error_description ? `: ${body.error_description}` : ""
    return `wspc token refresh failed (${body.error}${detail}); re-authenticate via \`wspc login\``
  } catch {
    return undefined
  }
}

export function createAuthInterceptor(mode: AuthMode): AuthInterceptor {
  if ("apiKey" in mode) {
    const apiKey = mode.apiKey
    const fetchImpl = mode.fetchImpl ?? fetch
    return {
      async onRequest(req) {
        req.headers.set("authorization", `Bearer ${apiKey}`)
        req.headers.set("user-agent", USER_AGENT)
        return req
      },
      async execute(req) {
        const out = await this.onRequest(req.clone())
        return fetchImpl(out)
      },
    }
  }

  let accessToken = mode.accessToken
  let refreshToken = mode.refreshToken
  let expiresAt = mode.expiresAt
  const { baseUrl, clientId, onTokenRefresh, loadPersisted } = mode
  const fetchImpl = mode.fetchImpl ?? fetch
  const now = mode.now ?? Date.now

  // Refresh a little early so a token that is about to lapse (or a slightly
  // skewed clock) doesn't slip through and still eat a 401 server-side.
  const SKEW_MS = 30_000

  // "We positively know this token is still good." An unknown expiry is not
  // fresh, but it isn't known-stale either — that case falls to the 401 path.
  function isFresh(until: number | undefined): boolean {
    return until !== undefined && now() < until - SKEW_MS
  }

  // Adopt tokens that landed in the store after we cached ours. Returns true
  // when the adopted access token is still usable, meaning no refresh is needed
  // at all — someone else already did it and rotating again would present a
  // token the server has superseded.
  async function adoptPersisted(): Promise<boolean> {
    const persisted = await loadPersisted?.()
    if (!persisted || persisted.refreshToken === refreshToken) return false
    accessToken = persisted.accessToken
    refreshToken = persisted.refreshToken
    expiresAt = persisted.expiresAt
    return isFresh(expiresAt)
  }

  async function refreshOnce(): Promise<void> {
    if (await adoptPersisted()) return

    const refreshRes = await fetchImpl(`${baseUrl}/auth/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    })
    if (!refreshRes.ok) {
      throw new WspcAuthExpiredError(await expiredMessage(refreshRes))
    }
    const tokens = (await refreshRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }
    accessToken = tokens.access_token
    refreshToken = tokens.refresh_token
    expiresAt = now() + tokens.expires_in * 1000
    await onTokenRefresh({ accessToken, refreshToken, expiresAt })
  }

  // Single-flight: concurrent callers (e.g. a Promise.all of API requests that
  // all see an expired token) share one rotation instead of racing to spend the
  // same refresh token.
  let inFlight: Promise<void> | undefined
  function refresh(): Promise<void> {
    inFlight ??= refreshOnce().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  return {
    async onRequest(req) {
      req.headers.set("authorization", `Bearer ${accessToken}`)
      req.headers.set("user-agent", USER_AGENT)
      return req
    },
    async execute(req) {
      // Proactive path: when we already know the token is expired, refresh
      // before the request rather than wasting a round-trip on a sure 401.
      if (expiresAt !== undefined && !isFresh(expiresAt)) {
        await refresh()
      }

      const sentWith = accessToken
      const first = await fetchImpl(await this.onRequest(req.clone()))
      if (first.status !== 401) return first

      // Reactive fallback: server revoked early, clock skew, or expiry unknown.
      // If a concurrent refresh already replaced the token this request went out
      // with, that 401 is stale — retry on the new token rather than rotating
      // again for nothing.
      if (accessToken === sentWith) await refresh()
      return fetchImpl(await this.onRequest(req.clone()))
    },
  }
}

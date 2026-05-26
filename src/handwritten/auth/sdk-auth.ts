import { WspcAuthExpiredError } from "../../index.js"

export type AuthMode =
  | { apiKey: string }
  | {
      accessToken: string
      refreshToken: string
      baseUrl: string
      clientId: string
      onTokenRefresh: (next: { accessToken: string; refreshToken: string; expiresAt: number }) => void | Promise<void>
      fetchImpl?: typeof fetch
      now?: () => number
    }

export interface AuthInterceptor {
  onRequest(req: Request): Promise<Request>
  execute(req: Request): Promise<Response>
}

export function createAuthInterceptor(mode: AuthMode): AuthInterceptor {
  if ("apiKey" in mode) {
    const apiKey = mode.apiKey
    return {
      async onRequest(req) {
        req.headers.set("authorization", `Bearer ${apiKey}`)
        return req
      },
      async execute(req) {
        const out = await this.onRequest(req.clone())
        return fetch(out)
      },
    }
  }

  let accessToken = mode.accessToken
  let refreshToken = mode.refreshToken
  const fetchImpl = mode.fetchImpl ?? fetch
  const now = mode.now ?? Date.now

  return {
    async onRequest(req) {
      req.headers.set("authorization", `Bearer ${accessToken}`)
      return req
    },
    async execute(req) {
      const first = await fetchImpl(await this.onRequest(req.clone()))
      if (first.status !== 401) return first

      const refreshRes = await fetchImpl(`${mode.baseUrl}/auth/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: mode.clientId,
        }),
      })
      if (!refreshRes.ok) {
        throw new WspcAuthExpiredError()
      }
      const tokens = (await refreshRes.json()) as {
        access_token: string
        refresh_token: string
        expires_in: number
      }
      accessToken = tokens.access_token
      refreshToken = tokens.refresh_token
      await mode.onTokenRefresh({
        accessToken,
        refreshToken,
        expiresAt: now() + tokens.expires_in * 1000,
      })
      return fetchImpl(await this.onRequest(req.clone()))
    },
  }
}

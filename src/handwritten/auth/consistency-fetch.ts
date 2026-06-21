import type { ConfigStore, ConsistencyBookmarkService } from "../config/index.js"

const INVALID_BOOKMARK = "INVALID_CONSISTENCY_BOOKMARK"

const SERVICE_HEADERS: Record<ConsistencyBookmarkService, string> = {
  auth: "x-cb-auth",
  todo: "x-cb-todo",
  calendar: "x-cb-cal",
  drive: "x-cb-drive",
  email: "x-cb-email",
  push: "x-cb-push",
}

const KNOWN_HEADERS = Object.values(SERVICE_HEADERS)

export interface ConsistencyFetchOptions {
  store: ConfigStore
  envName: string
  apiBase: string
  fetchImpl?: typeof fetch
}

function normalizeBasePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "")
  return trimmed === "" ? "/" : trimmed
}

function isUnderApiBase(url: URL, apiBase: string): boolean {
  const base = new URL(apiBase)
  const basePath = normalizeBasePath(base.pathname)
  return (
    url.origin === base.origin &&
    (basePath === "/" || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
  )
}

function stripKnownBookmarkHeaders(request: Request): Request {
  if (!KNOWN_HEADERS.some((header) => request.headers.has(header))) return request
  const headers = new Headers(request.headers)
  for (const header of KNOWN_HEADERS) {
    headers.delete(header)
  }
  return new Request(request, { headers })
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.toLowerCase().split(";")[0]?.trim() ?? ""
  return mediaType === "application/json" || mediaType.endsWith("+json")
}

async function responseHasInvalidBookmark(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!isJsonContentType(contentType)) return false

  try {
    const body = (await response.clone().json()) as { error?: { code?: string } }
    return body.error?.code === INVALID_BOOKMARK
  } catch {
    return false
  }
}

export function createConsistencyFetch(opts: ConsistencyFetchOptions): typeof fetch {
  const fetchImpl = opts.fetchImpl ?? fetch

  return async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const applies = isUnderApiBase(url, opts.apiBase)
    let outgoing = stripKnownBookmarkHeaders(request)
    const injectedBookmarks: Array<readonly [ConsistencyBookmarkService, string]> = []

    if (applies) {
      const config = await opts.store.read()
      const bookmarks = config.envs[opts.envName]?.consistency_bookmarks
      if (bookmarks) {
        const headers = new Headers(outgoing.headers)
        for (const [serviceName, header] of Object.entries(SERVICE_HEADERS)) {
          const service = serviceName as ConsistencyBookmarkService
          const bookmark = bookmarks[service]
          if (!bookmark) continue
          headers.set(header, bookmark)
          injectedBookmarks.push([service, bookmark])
        }
        if (injectedBookmarks.length > 0) {
          outgoing = new Request(outgoing, { headers })
        }
      }
    }

    const response = await fetchImpl(outgoing)
    if (!applies) return response

    const nextBookmarks = Object.entries(SERVICE_HEADERS).flatMap(([serviceName, header]) => {
      const value = response.headers.get(header)
      return value ? [[serviceName as ConsistencyBookmarkService, value] as const] : []
    })
    const shouldCheckInvalidBookmark = injectedBookmarks.length > 0 && !response.ok
    const invalidBookmark = shouldCheckInvalidBookmark ? await responseHasInvalidBookmark(response) : false
    if (nextBookmarks.length === 0 && !invalidBookmark) return response

    await opts.store.update((config) => {
      const env = config.envs[opts.envName]
      if (!env) return
      env.consistency_bookmarks ??= {}
      for (const [serviceName, value] of nextBookmarks) {
        env.consistency_bookmarks[serviceName] = value
      }
      if (invalidBookmark) {
        for (const [service, injectedValue] of injectedBookmarks) {
          if (env.consistency_bookmarks[service] === injectedValue) {
            delete env.consistency_bookmarks[service]
          }
        }
      }
      if (Object.keys(env.consistency_bookmarks).length === 0) {
        delete env.consistency_bookmarks
      }
    })

    return response
  }
}

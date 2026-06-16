import type { ConfigStore, ConsistencyBookmarkService } from "../config/index.js"

const INVALID_BOOKMARK = "INVALID_CONSISTENCY_BOOKMARK"

const SERVICE_HEADERS: Record<ConsistencyBookmarkService, string> = {
  auth: "x-cb-auth",
  todo: "x-cb-todo",
  calendar: "x-cb-cal",
  email: "x-cb-email",
  push: "x-cb-push",
}

const SERVICE_PREFIXES: Array<{ service: ConsistencyBookmarkService; prefix: string }> = [
  { service: "auth", prefix: "/auth" },
  { service: "todo", prefix: "/todo" },
  { service: "calendar", prefix: "/calendar" },
  { service: "email", prefix: "/email" },
  { service: "push", prefix: "/push" },
]

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

function pathWithinApiBase(url: URL, apiBase: string): string {
  const basePath = normalizeBasePath(new URL(apiBase).pathname)
  if (basePath === "/") return url.pathname
  if (url.pathname === basePath) return "/"
  return url.pathname.slice(basePath.length) || "/"
}

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function serviceForPath(pathname: string): ConsistencyBookmarkService | undefined {
  return SERVICE_PREFIXES.find(({ prefix }) => pathMatchesPrefix(pathname, prefix))?.service
}

function stripKnownBookmarkHeaders(request: Request, keep?: string): Request {
  if (!KNOWN_HEADERS.some((header) => header !== keep && request.headers.has(header))) return request
  const headers = new Headers(request.headers)
  for (const header of KNOWN_HEADERS) {
    if (header !== keep) headers.delete(header)
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
    let outgoing = request
    let injectedService: ConsistencyBookmarkService | undefined
    const service = applies ? serviceForPath(pathWithinApiBase(url, opts.apiBase)) : undefined
    const serviceHeader = service ? SERVICE_HEADERS[service] : undefined
    outgoing = stripKnownBookmarkHeaders(outgoing, applies ? serviceHeader : undefined)

    if (applies && service) {
      const header = SERVICE_HEADERS[service]
      if (!outgoing.headers.has(header)) {
        const config = await opts.store.read()
        const bookmark = config.envs[opts.envName]?.consistency_bookmarks?.[service]
        if (bookmark) {
          const headers = new Headers(outgoing.headers)
          headers.set(header, bookmark)
          outgoing = new Request(outgoing, { headers })
          injectedService = service
        }
      }
    }

    const response = await fetchImpl(outgoing)
    if (!applies) return response

    const nextBookmarks = Object.entries(SERVICE_HEADERS).flatMap(([serviceName, header]) => {
      const value = response.headers.get(header)
      return value ? [[serviceName as ConsistencyBookmarkService, value] as const] : []
    })
    const shouldCheckInvalidBookmark = injectedService !== undefined
    const invalidBookmark = shouldCheckInvalidBookmark ? await responseHasInvalidBookmark(response) : false
    if (nextBookmarks.length === 0 && !invalidBookmark) return response

    await opts.store.update((config) => {
      const env = config.envs[opts.envName]
      if (!env) return
      env.consistency_bookmarks ??= {}
      for (const [serviceName, value] of nextBookmarks) {
        env.consistency_bookmarks[serviceName] = value
      }
      if (invalidBookmark && injectedService) {
        delete env.consistency_bookmarks[injectedService]
      }
      if (Object.keys(env.consistency_bookmarks).length === 0) {
        delete env.consistency_bookmarks
      }
    })

    return response
  }
}

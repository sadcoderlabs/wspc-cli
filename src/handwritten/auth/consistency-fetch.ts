import type { ConfigStore } from "../config/index.js"

const HEADER = "x-consistency-bookmark"
const INVALID_BOOKMARK = "INVALID_CONSISTENCY_BOOKMARK"

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
    let injectedStoredBookmark = false

    if (applies && !outgoing.headers.has(HEADER)) {
      const config = await opts.store.read()
      const bookmark = config.envs[opts.envName]?.consistency_bookmark
      if (bookmark) {
        const headers = new Headers(outgoing.headers)
        headers.set(HEADER, bookmark)
        outgoing = new Request(outgoing, { headers })
        injectedStoredBookmark = true
      }
    }

    if (!applies && outgoing.headers.has(HEADER)) {
      const headers = new Headers(outgoing.headers)
      headers.delete(HEADER)
      outgoing = new Request(outgoing, { headers })
    }

    const response = await fetchImpl(outgoing)
    if (!applies) return response

    const nextBookmark = response.headers.get(HEADER)
    const shouldCheckInvalidBookmark = injectedStoredBookmark && !nextBookmark
    const invalidBookmark = shouldCheckInvalidBookmark
      ? await responseHasInvalidBookmark(response)
      : false
    const shouldClearBookmark = invalidBookmark
    if (!nextBookmark && !shouldClearBookmark) return response

    const config = await opts.store.read()
    const env = config.envs[opts.envName]
    if (!env) return response

    if (nextBookmark) {
      env.consistency_bookmark = nextBookmark
    } else if (shouldClearBookmark) {
      delete env.consistency_bookmark
    }
    await opts.store.write(config)

    return response
  }
}

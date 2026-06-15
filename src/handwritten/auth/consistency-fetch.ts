import type { ConfigStore } from "../config/index.js"

const HEADER = "x-consistency-bookmark"
const INVALID_BOOKMARK = "INVALID_CONSISTENCY_BOOKMARK"

export interface ConsistencyFetchOptions {
  store: ConfigStore
  envName: string
  apiBase: string
  fetchImpl?: typeof fetch
}

function isUnderApiBase(url: URL, apiBase: string): boolean {
  const base = new URL(apiBase)
  return url.origin === base.origin && url.pathname.startsWith(base.pathname)
}

async function responseHasInvalidBookmark(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return false

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

    if (applies && !outgoing.headers.has(HEADER)) {
      const config = await opts.store.read()
      const bookmark = config.envs[opts.envName]?.consistency_bookmark
      if (bookmark) {
        const headers = new Headers(outgoing.headers)
        headers.set(HEADER, bookmark)
        outgoing = new Request(outgoing, { headers })
      }
    }

    const response = await fetchImpl(outgoing)
    if (!applies) return response

    const nextBookmark = response.headers.get(HEADER)
    const invalidBookmark = await responseHasInvalidBookmark(response)
    if (!nextBookmark && !invalidBookmark) return response

    const config = await opts.store.read()
    const env = config.envs[opts.envName]
    if (!env) return response

    if (invalidBookmark) {
      delete env.consistency_bookmark
    } else if (nextBookmark) {
      env.consistency_bookmark = nextBookmark
    }
    await opts.store.write(config)

    return response
  }
}

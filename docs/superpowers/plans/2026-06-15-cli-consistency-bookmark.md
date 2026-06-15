# CLI Consistency Bookmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add env-scoped `x-consistency-bookmark` handling to every WSPC API HTTP call made by the CLI.

**Architecture:** Add one handwritten consistency-aware fetch wrapper and route all CLI WSPC fetch paths through it. Store the bookmark on `EnvConfig`, send it on same-env WSPC API requests, persist returned bookmarks, and clear the bookmark on `INVALID_CONSISTENCY_BOOKMARK` without retrying.

**Tech Stack:** TypeScript, Node fetch API, Vitest, existing `ConfigStore`, generated Hey API SDK client.

---

## File Structure

- Create `src/handwritten/auth/consistency-fetch.ts`
  - Owns bookmark request/response behavior for one env and API base.
  - Exports `createConsistencyFetch()` and small helpers used by tests.
- Modify `src/handwritten/config/index.ts`
  - Adds optional `consistency_bookmark?: string` to `EnvConfig`.
  - Normalizes that field only when present and string-valued.
- Modify `src/handwritten/auth/load-sdk-client.ts`
  - Wraps the generated SDK fetch and `loadAuthedFetch()` fetch.
- Modify `src/handwritten/auth/sdk-auth.ts`
  - Lets `apiKey` auth use injected `fetchImpl`.
  - Keeps OAuth refresh on the same wrapped fetch path.
- Modify `src/handwritten/auth/client-registration.ts`
  - Uses consistency fetch for `/auth/oauth/register`.
- Modify `src/handwritten/auth/device-flow.ts`
  - Uses consistency fetch for `/auth/oauth/device` and `/auth/oauth/token` polling.
- Modify `src/handwritten/auth/fetch-me.ts`
  - Uses consistency fetch for `/auth/me`.
- Modify `src/handwritten/auth/login.ts`
  - Passes `store` and `envName` through login/bootstrap helpers.
- Test `test/consistency-fetch.test.ts`
  - Unit tests for send, persist, clear, no retry, and non-WSPC URL behavior.
- Test existing auth/config files:
  - `test/config.test.ts`
  - `test/load-sdk-client.test.ts`
  - `test/load-sdk-client-multi.test.ts`
  - `test/client-registration.test.ts`
  - `test/login.test.ts`

Do not edit generated SDK/CLI files for bookmark support. The OpenAPI metadata is incomplete and this feature is CLI transport behavior.

### Task 1: Config Field

**Files:**
- Modify: `src/handwritten/config/index.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing config normalization test**

Add this test to `test/config.test.ts`:

```ts
it("normalizes env-level consistency bookmark when present", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bookmark-"))
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmark: "bookmark_1",
          accounts: {},
        },
      },
    }),
  )
  const store = new ConfigStore({ configDir: dir })
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmark).toBe("bookmark_1")
})

it("drops malformed consistency bookmark values", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bad-bookmark-"))
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmark: 123,
          accounts: {},
        },
      },
    }),
  )
  const store = new ConfigStore({ configDir: dir })
  const config = await store.read()
  expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- config.test.ts
```

Expected: FAIL because `EnvConfig` does not expose or normalize `consistency_bookmark`.

- [ ] **Step 3: Add env config field**

In `src/handwritten/config/index.ts`, update `EnvConfig`:

```ts
export interface EnvConfig {
  api_base: string
  // Opaque WSPC read-after-write consistency token scoped to this API env.
  consistency_bookmark?: string
  // RFC 7591 dynamically registered OAuth public client — server-level app
  // identity, shared by every account on this env. Kept across logout.
  client_id?: string
  current_account?: string // email of the active account in this env
  accounts: Record<string, AccountCreds>
}
```

Update `migrateEnv()` after creating `env`:

```ts
  if (typeof raw.consistency_bookmark === "string") {
    env.consistency_bookmark = raw.consistency_bookmark
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/config/index.ts test/config.test.ts
git commit -m "feat(cli): store env consistency bookmark"
```

### Task 2: Consistency Fetch Helper

**Files:**
- Create: `src/handwritten/auth/consistency-fetch.ts`
- Test: `test/consistency-fetch.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `test/consistency-fetch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../src/handwritten/config/index.js"
import { createConsistencyFetch } from "../src/handwritten/auth/consistency-fetch.js"

async function seededStore(bookmark?: string) {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-consistency-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        ...(bookmark ? { consistency_bookmark: bookmark } : {}),
        accounts: {},
      },
    },
  })
  return store
}

describe("createConsistencyFetch", () => {
  it("sends a stored bookmark to WSPC API requests", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items")

    const req = fetchImpl.mock.calls[0]![0] as Request
    expect(req.headers.get("x-consistency-bookmark")).toBe("bookmark_old")
  })

  it("does not overwrite an explicitly supplied bookmark header", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items", {
      headers: { "x-consistency-bookmark": "caller_bookmark" },
    })

    const req = fetchImpl.mock.calls[0]![0] as Request
    expect(req.headers.get("x-consistency-bookmark")).toBe("caller_bookmark")
  })

  it("persists a returned bookmark", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "x-consistency-bookmark": "bookmark_new" },
      }),
    )
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items")

    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmark).toBe("bookmark_new")
  })

  it("does not send bookmark to non-WSPC URLs", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://example.com/anything")

    const req = fetchImpl.mock.calls[0]![0] as Request
    expect(req.headers.get("x-consistency-bookmark")).toBeNull()
  })

  it("clears invalid bookmark errors without retrying", async () => {
    const store = await seededStore("bookmark_bad")
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "INVALID_CONSISTENCY_BOOKMARK", message: "bad bookmark" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    )
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    const res = await consistencyFetch("https://api.wspc.ai/todo/items")

    expect(res.status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const config = await store.read()
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- consistency-fetch.test.ts
```

Expected: FAIL because `src/handwritten/auth/consistency-fetch.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/handwritten/auth/consistency-fetch.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- consistency-fetch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/auth/consistency-fetch.ts test/consistency-fetch.test.ts
git commit -m "feat(cli): add consistency bookmark fetch"
```

### Task 3: Generated SDK And Authenticated Direct Fetch

**Files:**
- Modify: `src/handwritten/auth/load-sdk-client.ts`
- Modify: `src/handwritten/auth/sdk-auth.ts`
- Test: `test/load-sdk-client.test.ts`
- Test: `test/load-sdk-client-multi.test.ts`
- Test: `test/sdk-auth.test.ts`

- [ ] **Step 1: Write failing SDK loader test**

Add this test to `test/load-sdk-client.test.ts`:

```ts
it("sends and stores consistency bookmarks through SDK fetch", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-load-bookmark-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        current_account: "a@x.com",
        consistency_bookmark: "bookmark_old",
        accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } },
      },
    },
  })
  const seen: string[] = []
  const client = await loadSdkClient({
    store,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input)
      seen.push(req.headers.get("x-consistency-bookmark") ?? "")
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-consistency-bookmark": "bookmark_new",
        },
      })
    }) as typeof fetch,
  })

  await (client as { _rawClient: { get: (opts: { url: string }) => Promise<unknown> } })._rawClient.get({
    url: "/auth/me",
  })

  expect(seen).toEqual(["bookmark_old"])
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmark).toBe("bookmark_new")
})
```

- [ ] **Step 2: Write failing auth refresh test**

Add to `test/sdk-auth.test.ts` or extend the existing refresh test:

```ts
it("uses injected fetch for api-key auth requests", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const req = input instanceof Request ? input : new Request(input)
    expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
    return new Response("{}", { status: 200 })
  })
  const interceptor = createAuthInterceptor({ apiKey: "wspc_x", fetchImpl: fetchImpl as typeof fetch })

  await interceptor.execute(new Request("https://api.wspc.ai/todo/items"))

  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- load-sdk-client.test.ts sdk-auth.test.ts
```

Expected: FAIL because `loadSdkClient()` does not accept `fetchImpl`, and API-key auth ignores injected fetch.

- [ ] **Step 4: Update auth interceptor**

In `src/handwritten/auth/sdk-auth.ts`, add `fetchImpl?: typeof fetch` to the API-key variant:

```ts
export type AuthMode =
  | { apiKey: string; fetchImpl?: typeof fetch }
  | {
      accessToken: string
      refreshToken: string
      baseUrl: string
      clientId: string
      onTokenRefresh: (next: { accessToken: string; refreshToken: string; expiresAt: number }) => void | Promise<void>
      fetchImpl?: typeof fetch
      now?: () => number
    }
```

In the API-key branch:

```ts
  if ("apiKey" in mode) {
    const apiKey = mode.apiKey
    const fetchImpl = mode.fetchImpl ?? fetch
    return {
      async onRequest(req) {
        req.headers.set("authorization", `Bearer ${apiKey}`)
        return req
      },
      async execute(req) {
        const out = await this.onRequest(req.clone())
        return fetchImpl(out)
      },
    }
  }
```

- [ ] **Step 5: Update SDK loader**

In `src/handwritten/auth/load-sdk-client.ts`, import the helper:

```ts
import { createConsistencyFetch } from "./consistency-fetch.js"
```

Update types:

```ts
export async function loadSdkClient(
  opts: { store?: ConfigStore; fetchImpl?: typeof fetch } = {},
): Promise<LoadedClient> {
```

Pass `fetchImpl` into `buildInterceptor()` by adding a parameter:

```ts
function buildInterceptor(
  store: ConfigStore,
  resolved: ReturnType<typeof resolveAccount>,
  fetchImpl?: typeof fetch,
): ReturnType<typeof createAuthInterceptor> {
```

Use it in both auth modes:

```ts
  if (creds.api_key) {
    return createAuthInterceptor({ apiKey: creds.api_key, fetchImpl })
  }
```

and in OAuth mode:

```ts
    fetchImpl,
```

In `loadSdkClient()`, create the consistency fetch before the interceptor:

```ts
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: resolved.envName,
    apiBase: resolved.apiBase,
    fetchImpl: opts.fetchImpl,
  })
  const interceptor = buildInterceptor(store, resolved, consistencyFetch)
```

Keep the SDK fetch shape:

```ts
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        interceptor.execute(new Request(input as RequestInfo, init))) as typeof fetch,
```

Update `loadAuthedFetch()` the same way:

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm test -- load-sdk-client.test.ts load-sdk-client-multi.test.ts sdk-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/handwritten/auth/load-sdk-client.ts src/handwritten/auth/sdk-auth.ts test/load-sdk-client.test.ts test/load-sdk-client-multi.test.ts test/sdk-auth.test.ts
git commit -m "feat(cli): apply consistency bookmark to authenticated fetch"
```

### Task 4: Login And Bootstrap Fetches

**Files:**
- Modify: `src/handwritten/auth/client-registration.ts`
- Modify: `src/handwritten/auth/device-flow.ts`
- Modify: `src/handwritten/auth/fetch-me.ts`
- Modify: `src/handwritten/auth/login.ts`
- Test: `test/client-registration.test.ts`
- Test: `test/login.test.ts`

- [ ] **Step 1: Write failing client registration test**

In `test/client-registration.test.ts`, add:

```ts
it("sends and stores consistency bookmark during client registration", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-client-reg-bookmark-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        consistency_bookmark: "bookmark_old",
        accounts: {},
      },
    },
  })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const req = input instanceof Request ? input : new Request(input)
    expect(req.headers.get("x-consistency-bookmark")).toBe("bookmark_old")
    return new Response(JSON.stringify({ client_id: "client_NEW" }), {
      status: 201,
      headers: {
        "content-type": "application/json",
        "x-consistency-bookmark": "bookmark_new",
      },
    })
  })

  await ensureClientId({
    store,
    envName: "prod",
    baseUrl: "https://api.wspc.ai",
    fetchImpl: fetchImpl as typeof fetch,
  })

  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmark).toBe("bookmark_new")
})
```

Also update the existing `"registers + persists when no client_id present"`
URL assertion because the wrapped fetch passes a `Request` object to the
underlying test fetch:

```ts
    const req = fetchMock.mock.calls[0]![0] as Request
    expect(req.url).toBe("https://api.wspc.ai/auth/oauth/register")
```

- [ ] **Step 2: Write failing login fetch-me test**

In `test/login.test.ts`, add a test that proves API-key login passes store/envName to `fetchMe`:

```ts
it("passes store and envName to api-key login fetchMe", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-login-bookmark-"))
  const store = new ConfigStore({ configDir: dir })
  const fetchMe = vi.fn(async (opts) => {
    expect(opts.store).toBe(store)
    expect(opts.envName).toBe("prod")
    return { user_id: "usr_1", email: "a@x.com" }
  })

  await runLogin({
    store,
    baseUrl: "https://api.wspc.ai",
    apiKey: "wspc_x",
    output: { write: vi.fn(), writeJson: vi.fn() },
    fetchMe,
  })

  expect(fetchMe).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- client-registration.test.ts login.test.ts
```

Expected: FAIL because bootstrap helpers do not yet use consistency fetch or pass store/envName through `fetchMe`.

- [ ] **Step 4: Update bootstrap option types**

In `src/handwritten/auth/client-registration.ts`, extend options:

```ts
fetchImpl?: typeof fetch
```

Import and use the helper:

```ts
import { createConsistencyFetch } from "./consistency-fetch.js"
```

Before the registration request:

```ts
  const consistencyFetch = createConsistencyFetch({
    store: opts.store,
    envName: opts.envName,
    apiBase: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
  })
```

Replace `fetchImpl(...)` with `consistencyFetch(...)`.

- [ ] **Step 5: Update device flow**

In `src/handwritten/auth/device-flow.ts`, add options:

```ts
store?: ConfigStore
envName?: string
```

Import `ConfigStore` type and helper:

```ts
import type { ConfigStore } from "../config/index.js"
import { createConsistencyFetch } from "./consistency-fetch.js"
```

Build the fetch at the start:

```ts
  const fetchImpl =
    opts.store && opts.envName
      ? createConsistencyFetch({
          store: opts.store,
          envName: opts.envName,
          apiBase: opts.baseUrl,
          fetchImpl: opts.fetchImpl,
        })
      : (opts.fetchImpl ?? fetch)
```

Keep existing request logic using `fetchImpl`.

- [ ] **Step 6: Update fetch-me**

In `src/handwritten/auth/fetch-me.ts`, add options:

```ts
store?: ConfigStore
envName?: string
fetchImpl?: typeof fetch
```

Use consistency fetch when store/envName exist:

```ts
  const fetchImpl =
    opts.store && opts.envName
      ? createConsistencyFetch({
          store: opts.store,
          envName: opts.envName,
          apiBase: opts.baseUrl,
          fetchImpl: opts.fetchImpl,
        })
      : (opts.fetchImpl ?? fetch)
```

- [ ] **Step 7: Update login orchestration**

In `src/handwritten/auth/login.ts`, update `fetchMe` type:

```ts
  fetchMe?: (opts: {
    baseUrl: string
    token: string
    store: ConfigStore
    envName: string
  }) => Promise<{ user_id: string; email: string }>
```

Update the API-key `fetchMe` call:

```ts
    const who = await me({ baseUrl: opts.baseUrl, token: opts.apiKey, store: opts.store, envName })
```

If the exact `deviceFlow` option type currently does not include store/envName,
extend it in `RunLoginOptions`:

```ts
  deviceFlow?: (opts: {
    baseUrl: string
    clientId: string
    store: ConfigStore
    envName: string
    onPrompt: (p: unknown) => void
  }) => Promise<DeviceFlowResult>
```

Pass store/envName to the default `runDeviceFlow` call:

```ts
  const result = await flow({
    baseUrl: opts.baseUrl,
    clientId,
    store: opts.store,
    envName,
    onPrompt: ...
  })
```

Update the OAuth `fetchMe` call after device flow:

```ts
  const who = await me({ baseUrl: opts.baseUrl, token: result.access_token, store: opts.store, envName })
```

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
npm test -- client-registration.test.ts login.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/handwritten/auth/client-registration.ts src/handwritten/auth/device-flow.ts src/handwritten/auth/fetch-me.ts src/handwritten/auth/login.ts test/client-registration.test.ts test/login.test.ts
git commit -m "feat(cli): apply consistency bookmark during login"
```

### Task 5: End-To-End Verification

**Files:**
- Review: all files changed in Tasks 1-4

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- consistency-fetch.test.ts config.test.ts load-sdk-client.test.ts load-sdk-client-multi.test.ts sdk-auth.test.ts client-registration.test.ts login.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` exits 0.
- `git status --short` shows only intentional implementation changes plus any pre-existing unstaged `spec/openapi.json` sync diff.

- [ ] **Step 5: Final commit if needed**

If verification caused edits, stage the exact edited implementation/test files
from `git status --short` and commit them:

```bash
git status --short
git add src/handwritten/auth/consistency-fetch.ts test/consistency-fetch.test.ts
git commit -m "test(cli): verify consistency bookmark flow"
```

If those two files were not edited during final verification, replace them in
the `git add` command with the exact files that were edited. If no files changed
after Task 4, skip this commit.

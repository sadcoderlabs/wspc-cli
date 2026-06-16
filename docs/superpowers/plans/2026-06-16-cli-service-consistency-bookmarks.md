# CLI Service Consistency Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI's single `x-consistency-bookmark` with per-service `x-cb-*` consistency bookmarks.

**Architecture:** Keep the existing shared `createConsistencyFetch` integration point. Store bookmarks in `env.consistency_bookmarks` keyed by service, use a small path-prefix table to inject one matching request header, and persist any known response bookmark header.

**Tech Stack:** TypeScript, Node fetch APIs, Vitest, Commander-generated CLI, `@hey-api/openapi-ts`.

---

## File Structure

- Modify `src/handwritten/config/index.ts`: config type and normalization.
- Modify `src/handwritten/auth/consistency-fetch.ts`: per-service header selection, persistence, leakage prevention, invalid-bookmark clearing.
- Modify `test/config.test.ts`: config migration/normalization coverage.
- Modify `test/consistency-fetch.test.ts`: shared wrapper behavior coverage.
- Modify `test/load-sdk-client.test.ts`, `test/client-registration.test.ts`, `test/login.test.ts`: update old single-header integration tests.
- Modify `spec/openapi.json` and `src/generated/**`: output from `npm run sync-spec` and `npm run generate`.

---

### Task 1: Config Shape And Migration

**Files:**
- Modify: `src/handwritten/config/index.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add tests in `test/config.test.ts` replacing the old single-bookmark tests:

```ts
it("drops legacy env-level consistency bookmark", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-legacy-bookmark-"))
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmark: "bookmark_legacy",
          accounts: {},
        },
      },
    }),
  )
  const store = new ConfigStore({ configDir: dir })
  const config = await store.read()
  expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
  expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
})

it("normalizes service consistency bookmarks when present", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bookmarks-"))
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmarks: {
            auth: "auth_1",
            todo: "todo_1",
            calendar: "cal_1",
            email: "email_1",
            push: "push_1",
            bad_service: "ignored",
          },
          accounts: {},
        },
      },
    }),
  )
  const store = new ConfigStore({ configDir: dir })
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks).toEqual({
    auth: "auth_1",
    todo: "todo_1",
    calendar: "cal_1",
    email: "email_1",
    push: "push_1",
  })
})

it("drops malformed service consistency bookmark values", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-config-bad-bookmarks-"))
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      schema_version: 2,
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          consistency_bookmarks: {
            auth: 123,
            todo: "todo_1",
            calendar: null,
          },
          accounts: {},
        },
      },
    }),
  )
  const store = new ConfigStore({ configDir: dir })
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks).toEqual({ todo: "todo_1" })
})
```

- [ ] **Step 2: Run config tests and confirm failure**

Run: `npm test -- config.test.ts`

Expected: FAIL because `EnvConfig` does not expose `consistency_bookmarks` and normalization still preserves `consistency_bookmark`.

- [ ] **Step 3: Implement config normalization**

In `src/handwritten/config/index.ts`, replace the old bookmark field with:

```ts
export type ConsistencyBookmarkService = "auth" | "todo" | "calendar" | "email" | "push"

export type ConsistencyBookmarks = Partial<Record<ConsistencyBookmarkService, string>>
```

Update `EnvConfig`:

```ts
export interface EnvConfig {
  api_base: string
  consistency_bookmarks?: ConsistencyBookmarks
  client_id?: string
  current_account?: string
  accounts: Record<string, AccountCreds>
}
```

Add constants and helper near `V1_CRED_KEYS`:

```ts
const CONSISTENCY_BOOKMARK_SERVICES = ["auth", "todo", "calendar", "email", "push"] as const

function normalizeConsistencyBookmarks(raw: unknown): ConsistencyBookmarks | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const out: ConsistencyBookmarks = {}
  const obj = raw as Record<string, unknown>
  for (const service of CONSISTENCY_BOOKMARK_SERVICES) {
    if (typeof obj[service] === "string") out[service] = obj[service]
  }
  return Object.keys(out).length ? out : undefined
}
```

In `migrateEnv`, remove:

```ts
if (typeof raw.consistency_bookmark === "string") env.consistency_bookmark = raw.consistency_bookmark
```

Add:

```ts
const consistency_bookmarks = normalizeConsistencyBookmarks(raw.consistency_bookmarks)
if (consistency_bookmarks) env.consistency_bookmarks = consistency_bookmarks
```

- [ ] **Step 4: Run config tests and commit**

Run: `npm test -- config.test.ts`

Expected: PASS.

Commit:

```bash
git add src/handwritten/config/index.ts test/config.test.ts
git commit -m "feat(cli): store service consistency bookmarks"
```

---

### Task 2: Shared Consistency Fetch

**Files:**
- Modify: `src/handwritten/auth/consistency-fetch.ts`
- Test: `test/consistency-fetch.test.ts`

- [ ] **Step 1: Replace wrapper tests with service-specific cases**

Update `seededStore` in `test/consistency-fetch.test.ts`:

```ts
async function seededStore(bookmarks: Record<string, string> = {}): Promise<ConfigStore> {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-consistency-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        ...(Object.keys(bookmarks).length ? { consistency_bookmarks: bookmarks } : {}),
        accounts: {},
      },
    },
  })
  return store
}
```

Add/replace these core tests:

```ts
it("sends only the matching service bookmark", async () => {
  const store = await seededStore({
    auth: "auth_old",
    todo: "todo_old",
    calendar: "cal_old",
    email: "email_old",
    push: "push_old",
  })
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  await consistencyFetch("https://api.wspc.ai/auth/me")
  await consistencyFetch("https://api.wspc.ai/todo/items")
  await consistencyFetch("https://api.wspc.ai/calendar/events")
  await consistencyFetch("https://api.wspc.ai/email/messages")
  await consistencyFetch("https://api.wspc.ai/push/config")

  expect(fetchRequest(fetchImpl, 0).headers.get("x-cb-auth")).toBe("auth_old")
  expect(fetchRequest(fetchImpl, 0).headers.get("x-cb-todo")).toBeNull()
  expect(fetchRequest(fetchImpl, 1).headers.get("x-cb-todo")).toBe("todo_old")
  expect(fetchRequest(fetchImpl, 2).headers.get("x-cb-cal")).toBe("cal_old")
  expect(fetchRequest(fetchImpl, 3).headers.get("x-cb-email")).toBe("email_old")
  expect(fetchRequest(fetchImpl, 4).headers.get("x-cb-push")).toBe("push_old")
})

it("preserves caller supplied matching service header", async () => {
  const store = await seededStore({ todo: "todo_old" })
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  await consistencyFetch("https://api.wspc.ai/todo/items", {
    headers: { "x-cb-todo": "caller_todo" },
  })

  expect(fetchRequest(fetchImpl).headers.get("x-cb-todo")).toBe("caller_todo")
})

it("strips other service headers from known api paths", async () => {
  const store = await seededStore({ todo: "todo_old", email: "email_old" })
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  await consistencyFetch("https://api.wspc.ai/todo/items", {
    headers: { "x-cb-email": "caller_email" },
  })

  const req = fetchRequest(fetchImpl)
  expect(req.headers.get("x-cb-todo")).toBe("todo_old")
  expect(req.headers.get("x-cb-email")).toBeNull()
})

it("unknown api paths inject no bookmark but persist known response headers", async () => {
  const store = await seededStore({ todo: "todo_old" })
  const fetchImpl = vi.fn(
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "x-cb-email": "email_new" },
      }),
  )
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  await consistencyFetch("https://api.wspc.ai/files/abc")

  const req = fetchRequest(fetchImpl)
  expect(req.headers.get("x-cb-todo")).toBeNull()
  expect(req.headers.get("x-cb-email")).toBeNull()
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks).toMatchObject({
    todo: "todo_old",
    email: "email_new",
  })
})

it("strips known consistency headers from non-apiBase URLs", async () => {
  const store = await seededStore({ todo: "todo_old" })
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  await consistencyFetch("https://example.com/anything", {
    headers: {
      "x-cb-auth": "caller_auth",
      "x-cb-todo": "caller_todo",
      "x-cb-cal": "caller_cal",
      "x-cb-email": "caller_email",
      "x-cb-push": "caller_push",
      authorization: "Bearer token",
    },
  })

  const req = fetchRequest(fetchImpl)
  expect(req.headers.get("authorization")).toBe("Bearer token")
  expect(req.headers.get("x-cb-auth")).toBeNull()
  expect(req.headers.get("x-cb-todo")).toBeNull()
  expect(req.headers.get("x-cb-cal")).toBeNull()
  expect(req.headers.get("x-cb-email")).toBeNull()
  expect(req.headers.get("x-cb-push")).toBeNull()
})

it("clears only the injected service bookmark on invalid bookmark errors", async () => {
  const store = await seededStore({ todo: "todo_bad", email: "email_ok" })
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  )
  const consistencyFetch = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl,
  })

  const response = await consistencyFetch("https://api.wspc.ai/todo/items")

  expect(response.status).toBe(400)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks).toEqual({ email: "email_ok" })
})
```

- [ ] **Step 2: Run wrapper tests and confirm failure**

Run: `npm test -- consistency-fetch.test.ts`

Expected: FAIL because the wrapper still uses `x-consistency-bookmark` and `consistency_bookmark`.

- [ ] **Step 3: Implement per-service wrapper**

In `src/handwritten/auth/consistency-fetch.ts`, replace the single header constant with:

```ts
import type { ConfigStore, ConsistencyBookmarkService } from "../config/index.js"

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
```

Add helpers:

```ts
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
```

In `createConsistencyFetch`, track `injectedService` instead of a boolean:

```ts
let injectedService: ConsistencyBookmarkService | undefined
const service = applies ? serviceForPath(url.pathname) : undefined
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
```

After fetch, persist all known response bookmarks and clear only `injectedService`:

```ts
const nextBookmarks = Object.entries(SERVICE_HEADERS).flatMap(([service, header]) => {
  const value = response.headers.get(header)
  return value ? [[service as ConsistencyBookmarkService, value] as const] : []
})
const shouldCheckInvalidBookmark = injectedService !== undefined && nextBookmarks.length === 0
const invalidBookmark = shouldCheckInvalidBookmark
  ? await responseHasInvalidBookmark(response)
  : false
if (nextBookmarks.length === 0 && !invalidBookmark) return response

const config = await opts.store.read()
const env = config.envs[opts.envName]
if (!env) return response
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
await opts.store.write(config)
```

- [ ] **Step 4: Run wrapper tests and commit**

Run: `npm test -- consistency-fetch.test.ts config.test.ts`

Expected: PASS.

Commit:

```bash
git add src/handwritten/auth/consistency-fetch.ts test/consistency-fetch.test.ts
git commit -m "feat(cli): send service consistency bookmarks"
```

---

### Task 3: Update Integration Tests

**Files:**
- Modify: `test/load-sdk-client.test.ts`
- Modify: `test/client-registration.test.ts`
- Modify: `test/login.test.ts`

- [ ] **Step 1: Update SDK/authed fetch tests**

In `test/load-sdk-client.test.ts`, change stored bookmarks and expectations:

```ts
consistency_bookmarks: { todo: "todo_old" },
```

For `todoList`, assert:

```ts
expect(req.headers.get("x-cb-todo")).toBe("todo_old")
```

Return:

```ts
headers: {
  "content-type": "application/json",
  "x-cb-todo": "todo_new",
},
```

Assert:

```ts
expect(config.envs.prod?.consistency_bookmarks?.todo).toBe("todo_new")
```

For `loadAuthedFetch` using `/auth/me`, use `auth`:

```ts
consistency_bookmarks: { auth: "auth_old" },
expect(req.headers.get("x-cb-auth")).toBe("auth_old")
headers: { "x-cb-auth": "auth_new" }
expect(config.envs.prod?.consistency_bookmarks?.auth).toBe("auth_new")
```

- [ ] **Step 2: Update client registration tests**

In `test/client-registration.test.ts`, registration hits `/auth/oauth/register`, so use auth:

```ts
consistency_bookmarks: { auth: "auth_old" },
```

Expect request:

```ts
expect(req.headers.get("x-cb-auth")).toBe("auth_old")
```

Return and assert:

```ts
headers: {
  "content-type": "application/json",
  "x-cb-auth": "auth_new",
},
expect(c.envs.prod?.consistency_bookmarks?.auth).toBe("auth_new")
```

- [ ] **Step 3: Update login test**

In `test/login.test.ts`, the API-key bootstrap fetch hits `/auth/me`, so use:

```ts
headers: {
  "content-type": "application/json",
  "x-cb-auth": "auth_after_me",
},
```

Assert:

```ts
expect(c.envs.prod?.consistency_bookmarks?.auth).toBe("auth_after_me")
```

- [ ] **Step 4: Run integration tests and commit**

Run:

```bash
npm test -- load-sdk-client.test.ts client-registration.test.ts login.test.ts
```

Expected: PASS.

Commit:

```bash
git add test/load-sdk-client.test.ts test/client-registration.test.ts test/login.test.ts
git commit -m "test(cli): cover service consistency bookmark integrations"
```

---

### Task 4: Sync Spec And Generated Output

**Files:**
- Modify: `spec/openapi.json`
- Modify: `src/generated/**`

- [ ] **Step 1: Sync live OpenAPI spec**

Run:

```bash
npm run sync-spec
```

Expected: command exits 0 and updates `spec/openapi.json` with `x-cb-auth`, `x-cb-todo`, `x-cb-cal`, `x-cb-email`, and `x-cb-push`.

- [ ] **Step 2: Generate SDK/CLI output**

Run:

```bash
npm run generate
```

Expected: command exits 0 and updates generated files.

- [ ] **Step 3: Verify generated output is current**

Run:

```bash
git diff -- src/generated
```

Expected: any diff is generated output from the current `spec/openapi.json`. Inspect for unrelated handwritten changes; generated diffs are committed in the next step.

- [ ] **Step 4: Commit spec and generated output**

Commit:

```bash
git add spec/openapi.json src/generated
git commit -m "chore(spec): sync service consistency headers"
```

- [ ] **Step 5: Verify committed generated output is current**

Run:

```bash
git diff --exit-code -- src/generated
```

Expected: PASS.

---

### Task 5: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- config.test.ts consistency-fetch.test.ts load-sdk-client.test.ts client-registration.test.ts login.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test
```

Expected: all test files pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Confirm clean status**

Run:

```bash
git status --short
```

Expected: no uncommitted files.

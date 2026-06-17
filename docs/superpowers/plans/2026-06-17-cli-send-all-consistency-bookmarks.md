# CLI Send All Consistency Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every saved service consistency bookmark on each WSPC API request and clear all injected bookmarks on invalid-bookmark errors.

**Architecture:** Keep the existing `createConsistencyFetch` wrapper as the only behavior boundary. Replace path-selected injection with config-driven all-service injection for `apiBase` requests, while preserving response persistence and non-WSPC header stripping.

**Tech Stack:** TypeScript, Vitest, native Fetch `Request`/`Response`/`Headers`.

---

## File Structure

- Modify `test/consistency-fetch.test.ts`: update expectations from single-service injection to all-saved-bookmark injection, and add invalid-bookmark coverage for clearing every injected service.
- Modify `src/handwritten/auth/consistency-fetch.ts`: remove request-path service selection from outgoing injection, inject all saved bookmarks for `apiBase` requests, track injected services, and clear all injected services on `INVALID_CONSISTENCY_BOOKMARK`.

## Task 1: Update Consistency Fetch Tests

**Files:**
- Modify: `test/consistency-fetch.test.ts`

- [ ] **Step 1: Rename and update the path-service injection test**

Replace the first test body so it expects all saved bookmarks to be injected and caller bookmark headers to be replaced:

```ts
  it("sends all saved service bookmarks on WSPC API requests", async () => {
    const store = await seededStore({
      auth: "auth_1",
      todo: "todo_1",
      calendar: "cal_1",
      email: "email_1",
      push: "push_1",
    })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items", {
      headers: {
        "x-cb-auth": "caller_auth",
        "x-cb-email": "caller_email",
      },
    })

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-auth")).toBe("auth_1")
    expect(req.headers.get("x-cb-todo")).toBe("todo_1")
    expect(req.headers.get("x-cb-cal")).toBe("cal_1")
    expect(req.headers.get("x-cb-email")).toBe("email_1")
    expect(req.headers.get("x-cb-push")).toBe("push_1")
  })
```

- [ ] **Step 2: Replace caller-supplied matching-header test**

Replace `preserves caller supplied matching service header` with:

```ts
  it("replaces caller supplied service headers with saved bookmarks", async () => {
    const store = await seededStore({ todo: "todo_1", calendar: "cal_1" })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items", {
      headers: {
        "x-cb-todo": "caller_todo",
        "x-cb-cal": "caller_cal",
      },
    })

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-todo")).toBe("todo_1")
    expect(req.headers.get("x-cb-cal")).toBe("cal_1")
  })
```

- [ ] **Step 3: Replace known-path stripping test**

Replace `strips other service headers from known api paths` with:

```ts
  it("strips caller headers and injects all saved bookmarks on known api paths", async () => {
    const store = await seededStore({ auth: "auth_1", calendar: "cal_1", push: "push_1" })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/calendar/events", {
      headers: {
        "x-cb-auth": "caller_auth",
        "x-cb-cal": "caller_cal",
        "x-cb-todo": "caller_todo",
        "x-cb-email": "caller_email",
        "x-cb-push": "caller_push",
      },
    })

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-auth")).toBe("auth_1")
    expect(req.headers.get("x-cb-todo")).toBeNull()
    expect(req.headers.get("x-cb-cal")).toBe("cal_1")
    expect(req.headers.get("x-cb-email")).toBeNull()
    expect(req.headers.get("x-cb-push")).toBe("push_1")
  })
```

- [ ] **Step 4: Update unknown API path expectation**

In `unknown api paths inject no bookmark but persist known response headers`, rename the test to `unknown api paths inject all saved bookmarks and persist known response headers` and change the request expectations to:

```ts
    expect(req.headers.get("x-cb-auth")).toBe("auth_1")
    expect(req.headers.get("x-cb-todo")).toBe("todo_1")
    expect(req.headers.get("x-cb-cal")).toBeNull()
    expect(req.headers.get("x-cb-email")).toBeNull()
    expect(req.headers.get("x-cb-push")).toBeNull()
```

- [ ] **Step 5: Update invalid bookmark cleanup expectations**

In `clears only the injected service bookmark on invalid bookmark errors`, rename it to `clears all injected service bookmarks on invalid bookmark errors` and change the final stored config expectation to:

```ts
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
```

In `clears injected service bookmark when invalid response includes unrelated service bookmark`, rename it to `clears injected service bookmarks when invalid response includes a returned bookmark` and change the final expectation to:

```ts
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
```

- [ ] **Step 6: Update caller-supplied invalid bookmark test**

Replace `does not clear stored bookmark when caller-supplied matching service bookmark is invalid` with:

```ts
  it("clears saved bookmark even when caller supplied the same service header", async () => {
    const store = await seededStore({ todo: "todo_valid" })
    const response = new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
    const cloneSpy = vi.spyOn(response, "clone")
    const fetchImpl = vi.fn(async () => response)
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items", {
      headers: { "x-cb-todo": "caller_bad" },
    })

    expect(cloneSpy).toHaveBeenCalledOnce()
    const config = await store.read()
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
  })
```

- [ ] **Step 7: Update API-base path segment test**

In `matches trailing slash API base by path segment`, the exact base path now gets the saved bookmark because it is under `apiBase`. Change:

```ts
    expect(exactReq.headers.get("x-cb-todo")).toBe("todo_1")
```

Keep the child request as `"todo_1"` and sibling request as `null`.

- [ ] **Step 8: Run focused tests and confirm failure**

Run:

```bash
npm test -- consistency-fetch.test.ts
```

Expected: tests fail because implementation still sends only the path-selected bookmark.

- [ ] **Step 9: Commit failing tests**

```bash
git add test/consistency-fetch.test.ts
git commit -m "test(cli): expect all service bookmarks on requests"
```

## Task 2: Inject All Saved Bookmarks

**Files:**
- Modify: `src/handwritten/auth/consistency-fetch.ts`

- [ ] **Step 1: Remove path-service injection helpers**

Delete `SERVICE_PREFIXES`, `pathWithinApiBase`, `pathMatchesPrefix`, and `serviceForPath` from `src/handwritten/auth/consistency-fetch.ts`.

- [ ] **Step 2: Simplify header stripping**

Replace `stripKnownBookmarkHeaders` with:

```ts
function stripKnownBookmarkHeaders(request: Request): Request {
  if (!KNOWN_HEADERS.some((header) => request.headers.has(header))) return request
  const headers = new Headers(request.headers)
  for (const header of KNOWN_HEADERS) {
    headers.delete(header)
  }
  return new Request(request, { headers })
}
```

- [ ] **Step 3: Inject all saved bookmarks**

In `createConsistencyFetch`, replace the request-building block before `fetchImpl(outgoing)` with:

```ts
    const applies = isUnderApiBase(url, opts.apiBase)
    let outgoing = stripKnownBookmarkHeaders(request)
    const injectedServices: ConsistencyBookmarkService[] = []

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
          injectedServices.push(service)
        }
        if (injectedServices.length > 0) {
          outgoing = new Request(outgoing, { headers })
        }
      }
    }
```

- [ ] **Step 4: Clear every injected service on invalid bookmark**

Replace:

```ts
    const shouldCheckInvalidBookmark = injectedService !== undefined
```

with:

```ts
    const shouldCheckInvalidBookmark = injectedServices.length > 0
```

Replace:

```ts
      if (invalidBookmark && injectedService) {
        delete env.consistency_bookmarks[injectedService]
      }
```

with:

```ts
      if (invalidBookmark) {
        for (const service of injectedServices) {
          delete env.consistency_bookmarks[service]
        }
      }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- consistency-fetch.test.ts
```

Expected: pass.

- [ ] **Step 6: Run safety checks**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both pass, and `git diff --check` has no output.

- [ ] **Step 7: Commit implementation**

```bash
git add src/handwritten/auth/consistency-fetch.ts
git commit -m "fix(cli): send all consistency bookmarks"
```

## Task 3: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full tests**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test
```

Expected: all tests pass. Use this env because local color-sensitive tests can fail when `NO_COLOR` is set.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Check final diff**

Run:

```bash
git diff --check
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; diff includes the spec, this plan, `test/consistency-fetch.test.ts`, and `src/handwritten/auth/consistency-fetch.ts`.

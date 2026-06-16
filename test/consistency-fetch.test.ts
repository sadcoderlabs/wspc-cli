import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createConsistencyFetch } from "../src/handwritten/auth/consistency-fetch.js"
import { ConfigStore } from "../src/handwritten/config/index.js"

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

function fetchRequest(fetchImpl: ReturnType<typeof vi.fn>, index = 0): Request {
  return (fetchImpl.mock.calls as unknown as Array<[Request]>)[index]![0]
}

describe("createConsistencyFetch", () => {
  it("sends only the matching service bookmark", async () => {
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
    expect(req.headers.get("x-cb-auth")).toBeNull()
    expect(req.headers.get("x-cb-todo")).toBe("todo_1")
    expect(req.headers.get("x-cb-cal")).toBeNull()
    expect(req.headers.get("x-cb-email")).toBeNull()
    expect(req.headers.get("x-cb-push")).toBeNull()
  })

  it("preserves caller supplied matching service header", async () => {
    const store = await seededStore({ todo: "todo_1" })
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

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-todo")).toBe("caller_todo")
  })

  it("strips other service headers from known api paths", async () => {
    const store = await seededStore({ calendar: "cal_1" })
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
    expect(req.headers.get("x-cb-auth")).toBeNull()
    expect(req.headers.get("x-cb-cal")).toBe("caller_cal")
    expect(req.headers.get("x-cb-todo")).toBeNull()
    expect(req.headers.get("x-cb-email")).toBeNull()
    expect(req.headers.get("x-cb-push")).toBeNull()
  })

  it("unknown api paths inject no bookmark but persist known response headers", async () => {
    const store = await seededStore({ auth: "auth_1", todo: "todo_1" })
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "x-cb-auth": "auth_2",
            "x-cb-email": "email_2",
          },
        }),
    )
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/search", {
      headers: {
        "x-cb-todo": "caller_todo",
        "x-cb-push": "caller_push",
      },
    })

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-auth")).toBeNull()
    expect(req.headers.get("x-cb-todo")).toBeNull()
    expect(req.headers.get("x-cb-cal")).toBeNull()
    expect(req.headers.get("x-cb-email")).toBeNull()
    expect(req.headers.get("x-cb-push")).toBeNull()

    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks).toEqual({
      auth: "auth_2",
      todo: "todo_1",
      email: "email_2",
    })
  })

  it("strips known consistency headers from non-apiBase URLs", async () => {
    const store = await seededStore({ todo: "todo_1" })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://example.com/anything", {
      headers: {
        authorization: "Bearer token",
        "x-cb-auth": "caller_auth",
        "x-cb-todo": "caller_todo",
        "x-cb-cal": "caller_cal",
        "x-cb-email": "caller_email",
        "x-cb-push": "caller_push",
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
    const store = await seededStore({ auth: "auth_1", todo: "todo_bad", calendar: "cal_1" })
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
    expect(await response.json()).toEqual({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks).toEqual({ auth: "auth_1", calendar: "cal_1" })
  })

  it("does not clear stored bookmark when caller-supplied matching service bookmark is invalid", async () => {
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

    expect(cloneSpy).not.toHaveBeenCalled()
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks).toEqual({ todo: "todo_valid" })
  })

  it("persists all returned service bookmarks", async () => {
    const store = await seededStore({ todo: "todo_old" })
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "x-cb-auth": "auth_new",
            "x-cb-todo": "todo_new",
            "x-cb-cal": "cal_new",
            "x-cb-email": "email_new",
            "x-cb-push": "push_new",
          },
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
    expect(config.envs.prod?.consistency_bookmarks).toEqual({
      auth: "auth_new",
      todo: "todo_new",
      calendar: "cal_new",
      email: "email_new",
      push: "push_new",
    })
  })

  it("does not create missing env when response bookmark is returned", async () => {
    const store = await seededStore()
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "x-cb-todo": "todo_new" },
        }),
    )
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "staging",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items")

    const config = await store.read()
    expect(config.current_env).toBe("prod")
    expect(config.envs.prod).toBeDefined()
    expect(config.envs.staging).toBeUndefined()
  })

  it("does not parse invalid bookmark body when response bookmark is present", async () => {
    const store = await seededStore({ todo: "todo_old" })
    const response = new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "x-cb-todo": "todo_new",
      },
    })
    const cloneSpy = vi.spyOn(response, "clone")
    const fetchImpl = vi.fn(async () => response)
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/todo/items")

    expect(cloneSpy).not.toHaveBeenCalled()
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmarks?.todo).toBe("todo_new")
  })

  it("does not send bookmark to sibling prefix paths", async () => {
    const store = await seededStore({ todo: "todo_1" })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai/v1",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/v10/todo/items")

    const req = fetchRequest(fetchImpl)
    expect(req.headers.get("x-cb-todo")).toBeNull()
  })

  it("matches trailing slash API base by path segment", async () => {
    const store = await seededStore({ todo: "todo_1" })
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai/v1/",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/v1")
    await consistencyFetch("https://api.wspc.ai/v1/todo/items")
    await consistencyFetch("https://api.wspc.ai/v10/todo/items")

    const exactReq = fetchRequest(fetchImpl, 0)
    const childReq = fetchRequest(fetchImpl, 1)
    const siblingReq = fetchRequest(fetchImpl, 2)
    expect(exactReq.headers.get("x-cb-todo")).toBeNull()
    expect(childReq.headers.get("x-cb-todo")).toBe("todo_1")
    expect(siblingReq.headers.get("x-cb-todo")).toBeNull()
  })

  it("does not create missing env when invalid bookmark response would clear", async () => {
    const store = await seededStore()
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "staging",
      apiBase: "https://api.wspc.ai",
      fetchImpl,
    })

    const response = await consistencyFetch("https://api.wspc.ai/todo/items")

    expect(response.status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const config = await store.read()
    expect(config.current_env).toBe("prod")
    expect(config.envs.prod).toBeDefined()
    expect(config.envs.staging).toBeUndefined()
  })

  it("clears injected service bookmark on problem+json invalid bookmark errors", async () => {
    const store = await seededStore({ todo: "todo_bad" })
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
          status: 400,
          headers: { "content-type": "Application/Problem+Json" },
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
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmarks")
  })
})

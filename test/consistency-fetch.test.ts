import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createConsistencyFetch } from "../src/handwritten/auth/consistency-fetch.js"
import { ConfigStore } from "../src/handwritten/config/index.js"

async function seededStore(bookmark?: string): Promise<ConfigStore> {
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

  it("does not clear stored bookmark when caller-supplied bookmark is invalid", async () => {
    const store = await seededStore("bookmark_valid")
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
      headers: { "x-consistency-bookmark": "caller_bad" },
    })

    expect(cloneSpy).not.toHaveBeenCalled()
    const config = await store.read()
    expect(config.envs.prod?.consistency_bookmark).toBe("bookmark_valid")
  })

  it("persists a returned bookmark", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(
      async () =>
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

  it("does not parse invalid bookmark body when response bookmark is present", async () => {
    const store = await seededStore("bookmark_old")
    const response = new Response(JSON.stringify({ error: { code: "INVALID_CONSISTENCY_BOOKMARK" } }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "x-consistency-bookmark": "bookmark_new",
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

  it("strips caller-supplied bookmark from non-WSPC URLs", async () => {
    const store = await seededStore("bookmark_old")
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
        "x-consistency-bookmark": "caller_bookmark",
      },
    })

    const req = fetchImpl.mock.calls[0]![0] as Request
    expect(req.headers.get("authorization")).toBe("Bearer token")
    expect(req.headers.get("x-consistency-bookmark")).toBeNull()
  })

  it("does not send bookmark to sibling prefix paths", async () => {
    const store = await seededStore("bookmark_old")
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    const consistencyFetch = createConsistencyFetch({
      store,
      envName: "prod",
      apiBase: "https://api.wspc.ai/v1",
      fetchImpl,
    })

    await consistencyFetch("https://api.wspc.ai/v10/todo/items")

    const req = fetchImpl.mock.calls[0]![0] as Request
    expect(req.headers.get("x-consistency-bookmark")).toBeNull()
  })

  it("matches trailing slash API base by path segment", async () => {
    const store = await seededStore("bookmark_old")
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

    const exactReq = fetchImpl.mock.calls[0]![0] as Request
    const childReq = fetchImpl.mock.calls[1]![0] as Request
    const siblingReq = fetchImpl.mock.calls[2]![0] as Request
    expect(exactReq.headers.get("x-consistency-bookmark")).toBe("bookmark_old")
    expect(childReq.headers.get("x-consistency-bookmark")).toBe("bookmark_old")
    expect(siblingReq.headers.get("x-consistency-bookmark")).toBeNull()
  })

  it("clears env bookmark on invalid bookmark errors without retrying", async () => {
    const store = await seededStore("bookmark_bad")
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
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
  })

  it("clears injected env bookmark on problem+json invalid bookmark errors", async () => {
    const store = await seededStore("bookmark_bad")
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
    expect(config.envs.prod).not.toHaveProperty("consistency_bookmark")
  })
})

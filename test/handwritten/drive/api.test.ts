import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../../../src/handwritten/config/index.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"

const DRIVE_LIBRARY = {
  id: "lib_1",
  name: "notes",
  version: 1,
  file_count: 0,
  storage_bytes: 0,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_100,
}

const DRIVE_MANIFEST = {
  library: DRIVE_LIBRARY,
  entries: [],
  next_cursor: null,
}

const DRIVE_UPLOAD = {
  entry: {
    id: "ent_1",
    path: "notes/hello.txt",
    kind: "file" as const,
    entry_version: 2,
    current_version_id: "ver_2",
    content_sha256: "deadbeef",
    size_bytes: 5,
    updated_at: "2026-06-21T00:00:00.000Z",
  },
  result: "updated" as const,
}

const DRIVE_DELETE = {
  entry: {
    id: "ent_1",
    path: "notes/hello.txt",
    kind: "file" as const,
    entry_version: 2,
    current_version_id: "ver_2",
    content_sha256: "deadbeef",
    size_bytes: 5,
    updated_at: "2026-06-21T00:00:00.000Z",
  },
  result: "deleted" as const,
}

function mkReq(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) return input
  return new Request(input, init)
}

async function mkDriveApi(fetchImpl: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), "wspc-drive-api-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    schema_version: 2,
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        current_account: "a@x.com",
        accounts: {
          "a@x.com": { email: "a@x.com", api_key: "wspc_x" },
        },
      },
    },
  })
  return createDriveApi({ store, fetchImpl })
}

describe("createDriveApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getLibrary performs generated JSON GET and returns parsed library data", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      expect(req.method).toBe("GET")
      expect(req.url).toBe("https://api.wspc.ai/drive/libraries/lib_1")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify({ ...DRIVE_LIBRARY, deleted_at: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.getLibrary("lib_1")

    expect(result).toMatchObject(DRIVE_LIBRARY)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("getManifest passes optional cursor as query and returns parsed manifest data", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      expect(req.method).toBe("GET")
      const url = new URL(req.url)
      expect(url.pathname).toBe("/drive/libraries/lib_1/manifest")
      expect(url.searchParams.get("cursor")).toBe("cursor_1")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify(DRIVE_MANIFEST), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.getManifest("lib_1", "cursor_1")

    expect(result).toMatchObject(DRIVE_MANIFEST)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("deleteFile sends generated JSON POST with path/body/auth and returns parsed data", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("POST")
      expect(url.pathname).toBe("/drive/libraries/lib_1/files/delete")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      const body = await req.json()
      expect(body).toMatchObject({
        path: "notes/hello.txt",
        expected_entry_version: 2,
      })
      return new Response(JSON.stringify(DRIVE_DELETE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.deleteFile("lib_1", "notes/hello.txt", 2)

    expect(result).toMatchObject(DRIVE_DELETE)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("throws useful errors for failed JSON SDK calls", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    await expect(api.getLibrary("lib_1")).rejects.toThrow("HTTP 500")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uploadFile sends authed raw PUT with query + headers and parses JSON", async () => {
    const sha256 = "3a6eb7"
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("PUT")
      expect(url.pathname).toBe("/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe("notes/hello.txt")
      expect(url.searchParams.get("expected_entry_version")).toBe("2")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      expect(req.headers.get("content-type")).toBe("application/octet-stream")
      expect(req.headers.get("x-drive-content-sha256")).toBe(sha256)
      return new Response(JSON.stringify(DRIVE_UPLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.uploadFile("lib_1", "notes/hello.txt", 2, new TextEncoder().encode("hello"), sha256)

    expect(result).toMatchObject(DRIVE_UPLOAD)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("downloadFile sends raw GET and returns Response", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("GET")
      expect(url.pathname).toBe("/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe("notes/hello.txt")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.downloadFile("lib_1", "notes/hello.txt")

    expect(result).toBeInstanceOf(Response)
    expect(await result.text()).toBe("hello")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

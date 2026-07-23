import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../../../src/handwritten/config/index.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"
import { DriveHttpError } from "../../../src/handwritten/commands/drive/retry.js"

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

const RESERVED_LIBRARY_ID = "lib/space ?#"
const ENCODED_RESERVED_LIBRARY_ID = encodeURIComponent(RESERVED_LIBRARY_ID)

function mkReq(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) return input
  return new Request(input, init)
}

async function mkDriveApi(fetchImpl: typeof fetch, apiBase = "https://api.wspc.ai", clientId?: string) {
  const dir = await mkdtemp(join(tmpdir(), "wspc-drive-api-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    schema_version: 2,
    current_env: "prod",
    envs: {
      prod: {
        api_base: apiBase,
        current_account: "a@x.com",
        accounts: {
          "a@x.com": { email: "a@x.com", api_key: "wspc_x" },
        },
      },
    },
  })
  return createDriveApi({ store, fetchImpl, ...(clientId === undefined ? {} : { clientId }) })
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

  it("uploadFile and deleteFile identify the sync client via x-wspc-client", async () => {
    const seenHeaders: Array<string | null> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      seenHeaders.push(req.headers.get("x-wspc-client"))
      const payload = req.method === "PUT" ? DRIVE_UPLOAD : DRIVE_DELETE
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    await api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), "3a6eb7", 2)
    await api.deleteFile("lib_1", "notes/hello.txt", 2)

    expect(seenHeaders).toEqual(["drive-sync", "drive-sync"])
  })

  it("appends the session client id to x-wspc-client when provided", async () => {
    const seenHeaders: Array<string | null> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      seenHeaders.push(req.headers.get("x-wspc-client"))
      const payload = req.method === "PUT" ? DRIVE_UPLOAD : DRIVE_DELETE
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl, "https://api.wspc.ai", "drvcli_abc123")
    await api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), "3a6eb7", 2)
    await api.deleteFile("lib_1", "notes/hello.txt", 2)

    expect(seenHeaders).toEqual(["drive-sync/drvcli_abc123", "drive-sync/drvcli_abc123"])
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

  it("returns typed failures for manifest, delete, and move SDK calls", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "TEMPORARY_UNAVAILABLE", message: "try later" } }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "2" },
      }),
    ) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    for (const request of [
      () => api.getManifest("lib_1"),
      () => api.deleteFile("lib_1", "notes/hello.txt", 2),
      () => api.moveFile("lib_1", "notes/hello.txt", "notes/moved.txt", 2),
    ]) {
      await expect(request()).rejects.toMatchObject({
        name: "DriveHttpError",
        status: 503,
        code: "TEMPORARY_UNAVAILABLE",
        retryAfterMs: 2_000,
        message: "HTTP 503",
      })
    }
  })

  it("preserves SDK network failures for retry classification", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    await expect(api.getManifest("lib_1")).rejects.toMatchObject({
      name: "TypeError",
      message: "fetch failed",
    })
  })

  it("preserves rate-limit metadata without exposing the raw upload response body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "token=secret" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      }),
    ) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    const upload = api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), "3a6eb7")

    await expect(upload).rejects.toBeInstanceOf(DriveHttpError)
    await expect(upload).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterMs: 60_000,
      message: "HTTP 429",
    })
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
    const result = await api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), sha256, 2)

    expect(result).toMatchObject(DRIVE_UPLOAD)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uploadFile omits optional expected version while preserving decoded path", async () => {
    const sha256 = "3a6eb7"
    const uploadPath = "notes/space dir/你好.txt"
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("PUT")
      expect(url.pathname).toBe("/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe(uploadPath)
      expect(url.searchParams.has("expected_entry_version")).toBe(false)
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify(DRIVE_UPLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.uploadFile("lib_1", uploadPath, new TextEncoder().encode("hello"), sha256)

    expect(result).toMatchObject(DRIVE_UPLOAD)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uploadFile encodes opaque library ids in raw content URLs", async () => {
    const sha256 = "3a6eb7"
    const uploadPath = "notes/hello.txt"
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("PUT")
      expect(url.pathname).toBe(`/drive/libraries/${ENCODED_RESERVED_LIBRARY_ID}/files/content`)
      expect(url.searchParams.get("path")).toBe(uploadPath)
      expect(url.searchParams.get("expected_entry_version")).toBe("0")
      expect(url.hash).toBe("")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify(DRIVE_UPLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.uploadFile(RESERVED_LIBRARY_ID, uploadPath, new TextEncoder().encode("hello"), sha256, 0)

    expect(result).toMatchObject(DRIVE_UPLOAD)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uploadFile preserves configured API base path in raw content URLs", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("PUT")
      expect(url.origin).toBe("https://proxy.example.com")
      expect(url.pathname).toBe("/api/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe("notes/hello.txt")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify(DRIVE_UPLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl, "https://proxy.example.com/api")
    const result = await api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), "3a6eb7")

    expect(result).toMatchObject(DRIVE_UPLOAD)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uploadFile throws a structured error without exposing a failed raw response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("version mismatch", { status: 409 })) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    await expect(
      api.uploadFile("lib_1", "notes/hello.txt", new TextEncoder().encode("hello"), "3a6eb7"),
    ).rejects.toMatchObject({ status: 409, message: "HTTP 409" })
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

  it("downloadFile includes version_id when provided", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(url.pathname).toBe("/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe("notes/today.md")
      expect(url.searchParams.get("version_id")).toBe("ver_base")
      return new Response("base", { status: 200 })
    }) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    await api.downloadFile("lib_1", "notes/today.md", "ver_base")

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("downloadFile encodes opaque library ids in raw content URLs", async () => {
    const downloadPath = "notes/hello.txt"
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("GET")
      expect(url.pathname).toBe(`/drive/libraries/${ENCODED_RESERVED_LIBRARY_ID}/files/content`)
      expect(url.searchParams.get("path")).toBe(downloadPath)
      expect(url.searchParams.toString()).toBe("path=notes%2Fhello.txt")
      expect(url.hash).toBe("")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl)
    const result = await api.downloadFile(RESERVED_LIBRARY_ID, downloadPath)

    expect(await result.text()).toBe("hello")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("downloadFile preserves configured API base path with trailing slash in raw content URLs", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = mkReq(input, init)
      const url = new URL(req.url)
      expect(req.method).toBe("GET")
      expect(url.origin).toBe("https://proxy.example.com")
      expect(url.pathname).toBe("/api/drive/libraries/lib_1/files/content")
      expect(url.searchParams.get("path")).toBe("notes/hello.txt")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }) as typeof fetch

    const api = await mkDriveApi(fetchImpl, "https://proxy.example.com/api/")
    const result = await api.downloadFile("lib_1", "notes/hello.txt")

    expect(await result.text()).toBe("hello")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("downloadFile throws a structured error without exposing a failed raw response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing file", { status: 404 })) as typeof fetch
    const api = await mkDriveApi(fetchImpl)

    await expect(api.downloadFile("lib_1", "notes/missing.txt")).rejects.toMatchObject({ status: 404, message: "HTTP 404" })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

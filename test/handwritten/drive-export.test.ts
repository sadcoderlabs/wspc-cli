import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { mkdtemp, rm, readFile, writeFile, readdir, symlink } from "node:fs/promises"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigStore } from "../../src/handwritten/config/index.js"
import { driveExportCommand } from "../../src/handwritten/commands/drive/export.js"

vi.mock("node:fs/promises", { spy: true })

let root: string
let store: ConfigStore
let output: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "drive-export-"))
  store = new ConfigStore({ configDir: root })
  await store.write({
    current_env: "test",
    envs: {
      test: {
        api_base: "https://export.test",
        current_account: "one@example.test",
        accounts: {
          "one@example.test": {
            email: "one@example.test",
            api_key: "secret-one",
          },
        },
      },
    },
  })
  output = ""
  vi.stubEnv("WSPC_OUTPUT", "json")
  vi.stubEnv("WSPC_ACCOUNT", "")
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk)
    return true
  })
})

afterEach(async () => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

it("shows an empty Workspace using the resolved Account", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const request = new Request(input)
    expect(request.url).toBe("https://export.test/drive/export")
    expect(request.headers.get("authorization")).toBe("Bearer secret-one")
    return Response.json({ workspace_id: "org_test", job: null })
  })
  await driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"])
  expect(JSON.parse(output)).toEqual({
    account: "one@example.test",
    workspace_id: "org_test",
    job: null,
  })
})

it("returns an explicitly reused unfinished job without resending POST", async () => {
  const job = {
    id: "exp_test",
    status: "running",
    items_written: 0,
    items_total: null,
    bytes_written: 0,
    created_at: 1,
    updated_at: 1,
    completed_at: null,
    expires_at: null,
    error_code: null,
  }
  const fetchImpl = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "DRIVE_EXPORT_IN_PROGRESS",
          details: { workspace_id: "org_test", job },
        },
      },
      { status: 409 },
    ),
  )
  await driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "add"])
  expect(JSON.parse(output)).toEqual({
    account: "one@example.test",
    workspace_id: "org_test",
    job,
    reused: true,
  })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it("reports an unknown create outcome without exposing the network error or retrying", async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error("secret-one")
  })
  await expect(
    driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "add"]),
  ).rejects.toThrow("outcome is unknown; run `wspc drive export show`")
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(output).toBe("")
})

it("rejects a server without the Workspace contract", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ job: null }))
  await expect(
    driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"]),
  ).rejects.toThrow("compatible server")
  expect(output).toBe("")
})

it("downloads the requested job and publishes the exact bytes", async () => {
  const target = join(root, "package.tar")
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(new Request(input).url)
    if (url.pathname === "/drive/export")
      return Response.json({ workspace_id: "org_test", job: null })
    expect(url.searchParams.get("job_id")).toBe("exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F")
    expect(url.searchParams.get("workspace_id")).toBe("org_test")
    return new Response("archive bytes", {
      headers: {
        "content-type": "application/x-tar",
        "content-length": "13",
        "x-wspc-export-job-id": "exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
        "x-wspc-workspace-id": "org_test",
      },
    })
  })
  await driveExportCommand({ store, fetchImpl }).parseAsync([
    "node",
    "export",
    "download",
    "exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
    "--output",
    target,
  ])
  expect(await readFile(target, "utf8")).toBe("archive bytes")
  expect(JSON.parse(output)).toEqual({
    account: "one@example.test",
    workspace_id: "org_test",
    job_id: "exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
    output: target,
    bytes_written: 13,
  })
})

const jobId = "exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F"
function packageResponse(
  body: BodyInit = "archive bytes",
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/x-tar",
      "content-length": "13",
      "x-wspc-export-job-id": jobId,
      "x-wspc-workspace-id": "org_test",
      ...headers,
    },
  })
}
async function download(fetchPackage: () => Promise<Response> | Response): Promise<void> {
  const fetchImpl: typeof fetch = async (input) =>
    new URL(new Request(input).url).pathname === "/drive/export"
      ? Response.json({ workspace_id: "org_test", job: null })
      : fetchPackage()
  await driveExportCommand({ store, fetchImpl }).parseAsync([
    "node",
    "export",
    "download",
    jobId,
    "--output",
    join(root, "package.tar"),
  ])
}

it.each<Record<string, string>>([
  { "x-wspc-export-job-id": "exp_wrong" },
  { "x-wspc-workspace-id": "org_wrong" },
  { "content-type": "application/json" },
  { "content-length": "-1" },
  { "content-length": "9007199254740992" },
  { "content-length": "12" },
  { "content-length": "14" },
  { "content-encoding": "gzip" },
])("rejects invalid download metadata or length: %j", async (headers) => {
  await expect(download(() => packageResponse("archive bytes", headers))).rejects.toThrow()
  expect(await readdir(root)).toEqual(["config.json"])
  expect(output).toBe("")
})

it.each(["content-length", "x-wspc-export-job-id", "x-wspc-workspace-id", "content-type"])(
  "requires the %s header",
  async (header) => {
    await expect(
      download(() => {
        const response = packageResponse()
        response.headers.delete(header)
        return response
      }),
    ).rejects.toThrow("compatible server")
    expect(await readdir(root)).toEqual(["config.json"])
  },
)

it("does not overwrite a destination created while downloading", async () => {
  await expect(
    download(async () => {
      await writeFile(join(root, "package.tar"), "original")
      return packageResponse()
    }),
  ).rejects.toThrow()
  expect(await readFile(join(root, "package.tar"), "utf8")).toBe("original")
  expect((await readdir(root)).sort()).toEqual(["config.json", "package.tar"])
  expect(output).toBe("")
})

it("rejects a dangling symlink without changing it", async () => {
  await symlink(join(root, "missing"), join(root, "package.tar"))
  const fetchPackage = vi.fn(() => packageResponse())
  await expect(download(fetchPackage)).rejects.toThrow("already exists")
  expect(fetchPackage).not.toHaveBeenCalled()
  expect((await readdir(root)).sort()).toEqual(["config.json", "package.tar"])
})

it("does not expose credentials from a failed response stream", async () => {
  const result = download(() =>
    packageResponse(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("secret-one"))
        },
      }),
    ),
  )
  await expect(result).rejects.toThrow("Export transfer failed")
  expect(await readdir(root)).toEqual(["config.json"])
})

it("pins the Account across a concurrent active-account switch and OAuth refresh", async () => {
  await store.update((config) => {
    const env = config.envs.test!
    env.client_id = "client_test"
    env.accounts["one@example.test"] = {
      email: "one@example.test",
      access_token: "old-access",
      refresh_token: "old-refresh",
      access_token_expires_at: 1,
    }
    env.accounts["two@example.test"] = {
      email: "two@example.test",
      api_key: "secret-two",
    }
  })
  const paths: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    paths.push(url.pathname)
    if (url.pathname === "/auth/oauth/token") {
      expect(await req.text()).toContain("refresh_token=old-refresh")
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      })
    }
    expect(req.headers.get("authorization")).toBe("Bearer new-access")
    if (url.pathname === "/drive/export") {
      await store.update((config) => {
        config.envs.test!.current_account = "two@example.test"
      })
      return Response.json({ workspace_id: "org_test", job: null })
    }
    return packageResponse()
  }
  await driveExportCommand({ store, fetchImpl }).parseAsync([
    "node",
    "export",
    "download",
    jobId,
    "--output",
    join(root, "package.tar"),
  ])
  expect(paths).toEqual(["/auth/oauth/token", "/drive/export", "/drive/export/download"])
  expect(JSON.parse(output).account).toBe("one@example.test")
  const config = await store.read()
  expect(config.envs.test!.accounts["one@example.test"]!.refresh_token).toBe("new-refresh")
  expect(config.envs.test!.accounts["two@example.test"]!.api_key).toBe("secret-two")
  expect(output).not.toMatch(/old-access|old-refresh|new-access|new-refresh|secret-two/)
})

it.each([401, 403, 429, 500])(
  "reports HTTP %s and Retry-After without echoing the body",
  async (status) => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ token: "secret-one" }, { status, headers: { "retry-after": "12" } })
    await expect(
      driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"]),
    ).rejects.toThrow(`HTTP ${status}; Retry-After: 12`)
    expect(output).toBe("")
  },
)

it("does not print unrecognized fields returned by the server", async () => {
  const job = {
    id: jobId,
    status: "failed",
    items_written: 0,
    items_total: null,
    bytes_written: 0,
    created_at: 1,
    updated_at: 1,
    completed_at: null,
    expires_at: null,
    error_code: "packing_failed",
    access_token: "secret-one",
  }
  const fetchImpl: typeof fetch = async () => Response.json({ workspace_id: "org_test", job })
  await driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"])
  expect(output).not.toContain("secret-one")
  expect(JSON.parse(output).job.status).toBe("failed")
})

it.each(["SIGINT", "SIGTERM"] as const)(
  "cleans up an interrupted download on %s",
  async (signal) => {
    let cancelled = false
    await expect(
      download(() =>
        packageResponse(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new Uint8Array([1]))
              process.emit(signal)
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
      ),
    ).rejects.toThrow("Export transfer failed")
    expect(cancelled).toBe(true)
    expect(await readdir(root)).toEqual(["config.json"])
    expect(output).toBe("")
  },
)

it("cleans up a partial file after ENOSPC", async () => {
  const realOpen = (await vi.importActual<typeof fs>("node:fs/promises")).open
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const file = await realOpen(...args)
    if (String(args[0]).endsWith(".tmp")) {
      const realStream = file.createWriteStream.bind(file)
      vi.spyOn(file, "createWriteStream").mockImplementation((options) => {
        const stream = realStream(options)
        vi.spyOn(stream, "_write").mockImplementation((_chunk, _encoding, callback) =>
          callback(Object.assign(new Error("disk full"), { code: "ENOSPC" })),
        )
        return stream
      })
    }
    return file
  })
  await expect(download(() => packageResponse())).rejects.toThrow("ENOSPC")
  expect(await readdir(root)).toEqual(["config.json"])
  expect(output).toBe("")
})

it.each([true, false])(
  "reports a leftover temporary file after cleanup fails (published=%s)",
  async (published) => {
    let warning = ""
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      warning += String(chunk)
      return true
    })
    vi.spyOn(fs, "unlink").mockRejectedValue(
      Object.assign(new Error("cannot unlink"), { code: "EACCES" }),
    )
    const result = download(() =>
      packageResponse("archive bytes", published ? {} : { "content-length": "14" }),
    )
    if (published) {
      await result
      expect(await readFile(join(root, "package.tar"), "utf8")).toBe("archive bytes")
      expect(JSON.parse(output).bytes_written).toBe(13)
    } else {
      await expect(result).rejects.toThrow("shorter")
      expect(output).toBe("")
    }
    const temporary = (await readdir(root)).find((name) => name.endsWith(".tmp"))!
    expect(temporary).toBeTruthy()
    expect(warning).toContain(join(root, temporary))
    expect(warning).toContain(published ? "Output is complete" : "Download failed")
  },
)

it.each(["pending", "running", "completed", "failed", "expired"])(
  "preserves %s job fields and nullable progress",
  async (status) => {
    const job = {
      id: jobId,
      status,
      created_at: 1,
      updated_at: 2,
      completed_at: null,
      expires_at: null,
      items_written: 3,
      items_total: null,
      bytes_written: 1024,
      error_code: null,
    }
    const fetchImpl: typeof fetch = async () => Response.json({ workspace_id: "org_test", job })
    await driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"])
    expect(JSON.parse(output)).toEqual({
      account: "one@example.test",
      workspace_id: "org_test",
      job,
    })
  },
)

it("does not create a missing parent directory and cancels the response body", async () => {
  let cancelled = false
  const fetchImpl: typeof fetch = async (input) =>
    new URL(new Request(input).url).pathname === "/drive/export"
      ? Response.json({ workspace_id: "org_test", job: null })
      : packageResponse(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
        )
  await expect(
    driveExportCommand({ store, fetchImpl }).parseAsync([
      "node",
      "export",
      "download",
      jobId,
      "--output",
      join(root, "missing", "package.tar"),
    ]),
  ).rejects.toThrow("ENOENT")
  expect(cancelled).toBe(true)
  expect(await readdir(root)).toEqual(["config.json"])
  expect(output).toBe("")
})

it("does not expose a provider cancellation error when rejecting headers", async () => {
  await expect(
    download(() =>
      packageResponse(
        new ReadableStream({
          cancel() {
            throw new Error("secret-one")
          },
        }),
        { "content-type": "application/json" },
      ),
    ),
  ).rejects.toThrow("compatible server")
  expect(await readdir(root)).toEqual(["config.json"])
})

it("shows a new-export next step after a terminal failure", async () => {
  vi.stubEnv("WSPC_OUTPUT", "pretty")
  const job = {
    id: jobId,
    status: "failed",
    created_at: 1,
    updated_at: 2,
    completed_at: null,
    expires_at: null,
    items_written: 0,
    items_total: null,
    bytes_written: 0,
    error_code: "packing_failed",
  }
  const fetchImpl: typeof fetch = async () => Response.json({ workspace_id: "org_test", job })
  await driveExportCommand({ store, fetchImpl }).parseAsync(["node", "export", "show"])
  expect(output).toContain("Next: wspc drive export add")
  expect(output).toContain("packing_failed")
})

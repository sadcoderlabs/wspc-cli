import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

let directory: string
let requests: URL[]

beforeEach(async () => {
  vi.resetModules()
  directory = await mkdtemp(join(tmpdir(), "wspc-trash-command-"))
  vi.doMock("node:os", async (importOriginal) => ({
    ...await importOriginal<typeof import("node:os")>(),
    homedir: () => directory,
  }))
  await mkdir(join(directory, ".wspc"))
  await writeFile(join(directory, ".wspc", "config.json"), JSON.stringify({
    current_env: "prod",
    envs: { prod: {
      api_base: "https://calendar.test",
      current_account: "fixture@example.com",
      accounts: { "fixture@example.com": { email: "fixture@example.com", api_key: "wspc_fixture" } },
    } },
  }))
  requests = []
  vi.stubEnv("WSPC_ACCOUNT", "fixture@example.com")
  vi.stubEnv("WSPC_ENV", "prod")
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(new URL(request.url))
    return Response.json({ events: [] })
  })
  vi.spyOn(process.stdout, "write").mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.doUnmock("node:os")
  await rm(directory, { recursive: true, force: true })
})

it("sends the Trash boolean with existing filters and cursor through the real SDK", async () => {
  const { eventListCommand } = await import("../src/generated/cli/event/ls.js")
  eventListCommand.exitOverride()
  await eventListCommand.parseAsync(["node", "ls", "--deleted-only", "--q", "fixture", "--limit", "2", "--cursor", "page-position", "--include-past", "false"])
  expect(requests.map(url => url.pathname)).toEqual(["/calendar/events"])
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
    deleted_only: "true", q: "fixture", limit: "2", cursor: "page-position", include_past: "false",
  })
})

it("does not enable Trash when the flag is absent", async () => {
  const { eventListCommand } = await import("../src/generated/cli/event/ls.js")
  await eventListCommand.parseAsync(["node", "ls", "--q", "fixture"])
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ q: "fixture" })
})

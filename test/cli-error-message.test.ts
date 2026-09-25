import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cliErrorMessage, dispatch } from "../src/cli.js"
import { initDriveState } from "../src/handwritten/commands/drive/state.js"
import { DriveHttpError } from "../src/handwritten/commands/drive/retry.js"

// The config directory is resolved from HOME when the config module loads.
const testHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const home = mkdtempSync(join(tmpdir(), "wspc-cli-error-home-"))
  process.env.HOME = home
  process.env.USERPROFILE = home
  return home
})

describe("CLI error message", () => {
  it("prints the server error code next to the HTTP status", () => {
    expect(cliErrorMessage(new DriveHttpError(409, { code: "VERSION_CONFLICT" }))).toBe("HTTP 409 (VERSION_CONFLICT)")
  })

  it("prints only the status when the server sent no code", () => {
    expect(cliErrorMessage(new DriveHttpError(409))).toBe("HTTP 409")
  })

  it("leaves errors without an HTTP status unchanged", () => {
    const lockHeld = Object.assign(new Error("sync lock already exists"), { code: "WSPC_DRIVE_LOCK_HELD" })
    expect(cliErrorMessage(lockHeld)).toBe("sync lock already exists")
    expect(cliErrorMessage("plain failure")).toBe("plain failure")
  })
})

describe("CLI error output", () => {
  let server: Server | undefined

  afterEach(async () => {
    process.exitCode = undefined
    vi.restoreAllMocks()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it("prints the server code when a drive sync request is rejected", async () => {
    server = createServer((_request, response) => {
      response.writeHead(409, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "The remote entry changed." } }))
    })
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()))
    const { port } = server.address() as AddressInfo
    await mkdir(join(testHome, ".wspc"), { recursive: true })
    await writeFile(
      join(testHome, ".wspc", "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: `http://127.0.0.1:${port}`,
            current_account: "user@example.com",
            accounts: { "user@example.com": { email: "user@example.com", api_key: "wspc_test" } },
          },
        },
      }),
    )
    const folder = await mkdtemp(join(tmpdir(), "wspc-cli-error-folder-"))
    await initDriveState(folder, "lib_1")
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    await dispatch(["node", "wspc", "drive", "sync", "once", folder])

    expect(stderr).toHaveBeenCalledWith("error: HTTP 409 (VERSION_CONFLICT)\n")
    expect(process.exitCode).toBe(1)
  })
})

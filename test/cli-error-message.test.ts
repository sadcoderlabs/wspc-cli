import { describe, expect, it } from "vitest"
import { cliErrorMessage } from "../src/cli.js"
import { DriveHttpError } from "../src/handwritten/commands/drive/retry.js"

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

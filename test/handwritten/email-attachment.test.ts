import { describe, expect, it, vi, beforeEach } from "vitest"
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fetchMock = vi.fn()
vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadAuthedFetch: async () => ({
    fetch: fetchMock,
    baseUrl: "https://api.test",
  }),
  // loadSdkClient is also exported from this module; if your impl imports it
  // for some reason, leave a no-op mock here.
}))

import { attachmentCommand } from "../../src/handwritten/commands/email/attachment.js"

beforeEach(() => {
  fetchMock.mockReset()
})

describe("wspc email attachment", () => {
  it("writes binary body to --output path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    const out = join(dir, "got.pdf")
    const bytes = new Uint8Array([1, 2, 3, 4])
    fetchMock.mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="invoice.pdf"' },
      }),
    )
    await attachmentCommand.parseAsync(["node", "attachment", "eml_X", "0", "--output", out])
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out)).toEqual(Buffer.from(bytes))
  })

  it("derives output filename from Content-Disposition when --output omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    process.chdir(dir)
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="from-header.bin"' },
      }),
    )
    await attachmentCommand.parseAsync(["node", "attachment", "eml_X", "0"])
    expect(existsSync(join(dir, "from-header.bin"))).toBe(true)
  })

  it("falls back when Content-Disposition filename is a parent path", async () => {
    const parent = mkdtempSync(join(tmpdir(), "wspc-test-parent-"))
    const dir = join(parent, "cwd")
    mkdirSync(dir)
    process.chdir(dir)
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="../escape.txt"' },
      }),
    )

    await attachmentCommand.parseAsync(["node", "attachment", "eml_X", "0"])

    expect(existsSync(join(dir, "eml_X-0.bin"))).toBe(true)
    expect(existsSync(join(parent, "escape.txt"))).toBe(false)
  })

  it("prints error and sets exitCode=1 on 404", async () => {
    process.exitCode = undefined
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "EMAIL_NOT_FOUND" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    )
    await attachmentCommand.parseAsync([
      "node", "attachment", "eml_X", "0", "--output", "/tmp/x",
    ])
    expect(process.exitCode).toBe(1)
    errSpy.mockRestore()
    process.exitCode = undefined
  })

  it("passes --include-deleted as query param", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="a.bin"' },
      }),
    )
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    process.chdir(dir)
    await attachmentCommand.parseAsync([
      "node", "attachment", "eml_X", "0", "--include-deleted",
    ])
    const firstCallArg = fetchMock.mock.calls[0]?.[0]
    expect(firstCallArg).toBeInstanceOf(URL)
    expect((firstCallArg as URL).searchParams.get("include_deleted")).toBe("true")
  })
})

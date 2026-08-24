import { describe, expect, it, vi, beforeEach } from "vitest"
import { writeFileSync, mkdtempSync, truncateSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sendMock = vi.fn()
const renderMock = vi.fn()
vi.mock("../../src/generated/sdk/index.js", () => ({
  emailSend: (...args: unknown[]) => sendMock(...args),
}))
vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: async () => ({ _rawClient: {} }),
}))
vi.mock("../../src/handwritten/output/render.js", () => ({
  render: (...args: unknown[]) => renderMock(...args),
}))

// Import AFTER vi.mock calls (vitest hoists mocks but explicit ordering is clearer)
import { sendCommand } from "../../src/handwritten/commands/email/send.js"

beforeEach(() => {
  sendMock.mockReset()
  renderMock.mockReset()
  process.exitCode = undefined
  sendMock.mockResolvedValue({
    data: { email: { id: "out_X" }, idempotent_replay: false },
    response: { ok: true, status: 200 },
  })
})

describe("wspc email send", () => {
  it("fresh mode sends to/subject/text/idempotency_key", async () => {
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
      "--idempotency-key", "k1",
    ])
    expect(sendMock).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = sendMock.mock.calls[0]![0].body
    expect(body).toMatchObject({
      from_alias_email: "a@d",
      to: ["x@y"],
      subject: "S",
      text: "T",
      idempotency_key: "k1",
    })
    expect(body.in_reply_to_email_id).toBeUndefined()
    expect(body.attachments).toBeUndefined()
    expect(renderMock).toHaveBeenCalledWith(
      { kind: "object", display: { shape: "object", format: { id: "id-short" } } },
      { id: "out_X" },
    )
  })

  it("fresh mode sends repeatable CC and BCC recipient roles", async () => {
    await sendCommand.parseAsync([
      "node",
      "send",
      "--from",
      "a@d",
      "--to",
      "x@y",
      "--cc",
      "copy-one@y",
      "--cc",
      "copy-two@y",
      "--bcc",
      "hidden-one@y",
      "--bcc",
      "hidden-two@y",
      "--subject",
      "S",
      "--text",
      "T",
      "--idempotency-key",
      "roles-1",
    ])

    const body = sendMock.mock.calls[0]![0].body
    expect(body).toMatchObject({
      to: ["x@y"],
      cc: ["copy-one@y", "copy-two@y"],
      bcc: ["hidden-one@y", "hidden-two@y"],
    })
  })

  it("auto-generates idempotency_key when --idempotency-key omitted", async () => {
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
    ])
    expect(sendMock).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = sendMock.mock.calls[0]![0].body
    expect(typeof body.idempotency_key).toBe("string")
    // RFC 4122 UUID shape — server requires a 1-200 char key.
    expect(body.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it("reply mode omits to/subject when --reply set", async () => {
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--reply", "eml_R", "--text", "T",
      "--idempotency-key", "k2",
    ])
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = sendMock.mock.calls[0]![0].body
    expect(body.in_reply_to_email_id).toBe("eml_R")
    expect(body.to).toBeUndefined()
    expect(body.subject).toBeUndefined()
  })

  it.each(["--cc", "--bcc"])("reply mode rejects %s before sending", async (option) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      await sendCommand.parseAsync([
        "node",
        "send",
        "--from",
        "a@d",
        "--reply",
        "eml_R",
        option,
        "copy@y",
        "--text",
        "T",
      ])

      expect(sendMock).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      expect(stderr).toHaveBeenCalledWith(`${option} is not allowed with --reply\n`)
    } finally {
      stderr.mockRestore()
    }
  })

  it("--attach local file becomes inline attachment with base64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    const file = join(dir, "hello.txt")
    writeFileSync(file, "hello world")
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
      "--idempotency-key", "k3", "--attach", file,
    ])
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = sendMock.mock.calls[0]![0].body
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0]).toMatchObject({
      filename: "hello.txt",
      content_type: "text/plain",
      content_base64: Buffer.from("hello world").toString("base64"),
    })
  })

  it("--attach inbound ref becomes reference attachment", async () => {
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
      "--idempotency-key", "k4", "--attach", "eml_01HW3K4N9V5G6Z8C2Q7B1Y0M3F:0",
    ])
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = sendMock.mock.calls[0]![0].body
    expect(body.attachments[0]).toEqual({
      from_inbound_email_id: "eml_01HW3K4N9V5G6Z8C2Q7B1Y0M3F",
      idx: 0,
    })
  })

  it("rejects --attach pointing to neither file nor ref", async () => {
    process.exitCode = undefined
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
      "--idempotency-key", "k5", "--attach", "/no/such/file.bogus",
    ])
    expect(sendMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errSpy.mockRestore()
    process.exitCode = undefined
  })

  it("preserves the per-file size error for an oversized attachment", async () => {
    process.exitCode = undefined
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    const file = join(dir, "oversized.bin")
    writeFileSync(file, "")
    truncateSync(file, 5 * 1024 * 1024 + 1)

    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
      "--idempotency-key", "k6", "--attach", file,
    ])

    expect(sendMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(errSpy).toHaveBeenCalledOnce()
    expect(errSpy).toHaveBeenCalledWith(
      `Attachment ${file} (5242881 bytes) exceeds 5 MiB limit.\n`,
    )
    errSpy.mockRestore()
    process.exitCode = undefined
  })

  it("rejects both --text and --text-file set", async () => {
    process.exitCode = undefined
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
    const file = join(dir, "body.txt")
    writeFileSync(file, "from file")
    await sendCommand.parseAsync([
      "node", "send",
      "--from", "a@d", "--to", "x@y", "--subject", "S",
      "--text", "T", "--text-file", file,
      "--idempotency-key", "k7",
    ])
    expect(sendMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errSpy.mockRestore()
    process.exitCode = undefined
  })

  it("reports HTTP failures without rendering", async () => {
    sendMock.mockResolvedValue({
      error: { code: "SEND_FAILED" },
      response: { ok: false, status: 502 },
    })
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      await sendCommand.parseAsync([
        "node", "send",
        "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
        "--idempotency-key", "k7",
      ])

      expect(process.exitCode).toBe(1)
      expect(renderMock).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledWith('HTTP 502: {\n  "code": "SEND_FAILED"\n}\n')
    } finally {
      stderr.mockRestore()
    }
  })
})

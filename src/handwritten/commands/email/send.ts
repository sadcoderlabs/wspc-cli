import { Command } from "commander"
import { randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import { emailSend } from "../../../generated/sdk/index.js"
import { loadSdkClient } from "../../auth/load-sdk-client.js"
import { mimeFromExt } from "../../utils/mime-from-ext.js"
import { render } from "../../output/render.js"

const MAX_PER_ATTACHMENT = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT = 25 * 1024 * 1024
const MAX_TEXT_BYTES = 100 * 1024
const INBOUND_REF_RE = /^[a-z]+_[A-Z0-9]+:\d+$/

type Attachment =
  | { filename: string; content_type: string; content_base64: string }
  | { from_inbound_email_id: string; idx: number }

async function resolveAttachment(input: string): Promise<{ att: Attachment; size: number }> {
  let fileSize: number | undefined
  try {
    const s = await stat(input)
    if (s.isFile()) {
      fileSize = s.size
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw attachmentFileError(input, "inspect", error)
    }
  }

  if (fileSize !== undefined) {
    if (fileSize > MAX_PER_ATTACHMENT) {
      throw new Error(`Attachment ${input} (${fileSize} bytes) exceeds 5 MiB limit.`)
    }
    let buf: Buffer
    try {
      buf = await readFile(input)
    } catch (error) {
      throw attachmentFileError(input, "read", error)
    }
    return {
      att: {
        filename: basename(input),
        content_type: mimeFromExt(input),
        content_base64: buf.toString("base64"),
      },
      size: fileSize,
    }
  }

  if (INBOUND_REF_RE.test(input)) {
    const [emlId, idxStr] = input.split(":")
    return { att: { from_inbound_email_id: emlId!, idx: Number(idxStr) }, size: 0 }
  }
  throw new Error(
    `--attach ${input}: neither a readable file nor a valid <prefix>_<ulid>:<idx> reference.`,
  )
}

function attachmentFileError(
  input: string,
  operation: "inspect" | "read",
  error: unknown,
): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`--attach ${input}: unable to ${operation} local file: ${detail}`)
}

export const sendCommand = new Command("send")
  .description("Send an outbound email")
  .requiredOption("--from <alias-email>", "alias email to send from")
  .option("--to <addr...>", "recipient address (repeatable)", [])
  .option("--subject <text>", "subject")
  .option("--text <body>", "plain-text body")
  .option("--text-file <path>", "read text body from file")
  .option("--reply <id>", "inbound email id to reply to")
  .option("--attach <path-or-ref...>", "attachment (file path or eml_xxx:idx)", [])
  .option("--idempotency-key <key>", "idempotency key (auto-generated if omitted)")
  .action(async (opts) => {
    const isReply = Boolean(opts.reply)
    const to = opts.to as string[]
    const attachInputs = opts.attach as string[]

    // Resolve text source — mutually exclusive options
    if (opts.text && opts.textFile) {
      process.stderr.write("--text and --text-file are mutually exclusive\n")
      process.exitCode = 1
      return
    }
    let text: string | undefined = opts.text
    if (opts.textFile) {
      text = await readFile(opts.textFile as string, "utf8")
    }
    if (!text) {
      process.stderr.write("--text or --text-file is required\n")
      process.exitCode = 1
      return
    }
    if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
      process.stderr.write("text body exceeds 100 KiB\n")
      process.exitCode = 1
      return
    }

    // Validate fresh-mode required fields
    if (!isReply) {
      if (to.length === 0) {
        process.stderr.write("--to is required (or use --reply for thread replies)\n")
        process.exitCode = 1
        return
      }
      if (!opts.subject) {
        process.stderr.write("--subject is required (or use --reply for thread replies)\n")
        process.exitCode = 1
        return
      }
    }

    // Resolve attachments
    const attachments: Attachment[] = []
    let total = 0
    for (const input of attachInputs) {
      try {
        const { att, size } = await resolveAttachment(input)
        total += size
        attachments.push(att)
      } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`)
        process.exitCode = 1
        return
      }
    }
    if (total > MAX_TOTAL_ATTACHMENT) {
      process.stderr.write(`Attachments total ${total} bytes exceeds 25 MiB limit.\n`)
      process.exitCode = 1
      return
    }

    const body: Record<string, unknown> = {
      from_alias_email: opts.from,
      text,
      // Server requires an idempotency_key; a fresh random one makes each send a
      // distinct request, which is the right default for one-shot CLI sends.
      idempotency_key: opts.idempotencyKey ?? randomUUID(),
    }
    if (isReply) {
      body.in_reply_to_email_id = opts.reply
    } else {
      body.to = to
      body.subject = opts.subject
    }
    if (attachments.length > 0) body.attachments = attachments

    const client = await loadSdkClient()
    const result = await emailSend({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body,
    } as never)

    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render(
      { kind: "object", display: { shape: "object", format: { id: "id-short" } } },
      result.data!.email,
    )
  })

import { Command } from "commander"
import { createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { loadAuthedFetch } from "../../auth/load-sdk-client.js"
import { parseContentDispositionFilename } from "../../utils/parse-content-disposition.js"

export const attachmentCommand = new Command("attachment")
  .description("Download an inbound email attachment by index")
  .argument("<email-id>")
  .argument("<idx>")
  .option("--output <path>", "output file path")
  .option("--include-deleted", "allow downloads from soft-deleted parent emails")
  .action(async (emailId: string, idxArg: string, opts) => {
    const idx = Number(idxArg)
    if (!Number.isInteger(idx) || idx < 0) {
      process.stderr.write(`<idx> must be a non-negative integer (got "${idxArg}")\n`)
      process.exitCode = 1
      return
    }

    const { fetch: authedFetch, baseUrl } = await loadAuthedFetch()
    const url = new URL(`/email/messages/${emailId}/attachments/${idx}`, baseUrl)
    if (opts.includeDeleted) url.searchParams.set("include_deleted", "true")

    const res = await authedFetch(url)

    if (!res.ok) {
      const text = await res.text()
      process.stderr.write(`HTTP ${res.status}: ${text}\n`)
      process.exitCode = 1
      return
    }

    const filename =
      opts.output ??
      parseContentDispositionFilename(res.headers.get("content-disposition")) ??
      `${emailId}-${idx}.bin`

    if (!res.body) {
      process.stderr.write("response has no body\n")
      process.exitCode = 1
      return
    }

    const sink = createWriteStream(filename)
    await pipeline(Readable.fromWeb(res.body as never), sink)
    process.stdout.write(`Saved ${filename}\n`)
  })

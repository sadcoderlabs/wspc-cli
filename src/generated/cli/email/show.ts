// AUTO-GENERATED — DO NOT EDIT (source: email_get)
import { Command } from "commander"
import { emailGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailGetCommand = new Command("show")
  .description("Get an inbound email by id")
  .argument("<id>", "id")
  .option("--include-html <value>", "When `true`, fetch the HTML body from R2 and include it as `html_body` in the response. Costs an extra R2 read; omit if you only need text.")
  .option("--include-deleted <value>", "When `true`, allow fetching a soft-deleted email. Defaults to `false` (returns 404 for soft-deleted rows).")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await emailGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        include_html: opts.includeHtml,
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_get", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","user_id":"id-short","received_at":"relative-time","created_at":"relative-time","read_at":"relative-time","deleted_at":"relative-time","is_read":"bool-badge"},"dataPath":"email"} }, result.data)
  })

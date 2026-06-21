// AUTO-GENERATED — DO NOT EDIT (source: email_get)
import { Command } from "commander"
import { emailGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailGetCommand = new Command("show")
  .description("Get an inbound email by id")
  .argument("<id>", "id")
  .option("--include-html <value>", "When `true`, fetch the HTML body from R2 and include it as `html_body` in the response. Costs an extra R2 read; omit if you only need text.")
  .option("--include-deleted <value>", "When `true`, allow fetching a soft-deleted email. Defaults to `false` (returns 404 for soft-deleted rows).")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "email_get", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","user_id":"id-short","received_at":"relative-time","created_at":"relative-time","read_at":"relative-time","deleted_at":"relative-time","is_read":"bool-badge"},"dataPath":"email"} }, (client) => emailGet({
      client,
      path: {
        id,
      },
      query: {
        include_html: opts.includeHtml,
        include_deleted: opts.includeDeleted,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_get)
import { Command } from "commander"
import { emailGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailGetCommand = new Command("show")
  .description("Get an inbound email by id")
  .addHelpText("after", "\n### Overview\nFetches the metadata and plain-text body of a single inbound email by its unique ID. It also returns metadata for all associated attachments and optionally resolves the rendered HTML content.\n\n### When to Use\n- Use this endpoint to display the complete detail view of an email message.\n- Use it to extract attachment files or read complex HTML layouts.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **R2 HTML Read**: The HTML body is stored in Object Storage (R2). To fetch it, explicitly pass `include_html=true` (this incurs an extra R2 read charge; leave unset if only plain text is needed).\n- Returns a 404 error if the email has been soft-deleted, unless `include_deleted=true` is set.\n\n### Troubleshooting\n- **401 Unauthorized**: Missing or expired token.\n- **404 Not Found**: The specified email ID does not exist, belongs to another user, or has been soft-deleted (without `include_deleted=true`).\n")
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

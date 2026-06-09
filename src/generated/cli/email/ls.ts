// AUTO-GENERATED — DO NOT EDIT (source: email_list)
import { Command } from "commander"
import { emailList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailListCommand = new Command("ls")
  .description("List inbound emails")
  .option("--limit <value>", "Max items to return (clamped to 1-100). Defaults to 20 server-side.")
  .option("--alias-email <value>", "If set, only return emails received on this full alias email address.")
  .option("--unread-only <value>", "When `true`, only return emails with `is_read=false`.")
  .option("--since <value>", "Unix epoch milliseconds — only return emails with `received_at >= since`. Useful for incremental sync.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .option("--include-deleted <value>", "When `true`, also return soft-deleted emails. Defaults to `false`.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await emailList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        limit: opts.limit,
        alias_email: opts.aliasEmail,
        unread_only: opts.unreadOnly,
        since: opts.since,
        cursor: opts.cursor,
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
    render({ kind: "email_list", display: {"shape":"list","columns":["id","from_addr","subject","is_read","received_at"],"format":{"id":"id-short","from_addr":"truncate","subject":"truncate","is_read":"bool-badge","received_at":"relative-time"},"emptyMessage":"no emails"} }, result.data)
  })

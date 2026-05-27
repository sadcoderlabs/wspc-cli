// AUTO-GENERATED — DO NOT EDIT (source: email_list)
import { Command } from "commander"
import { emailList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailListCommand = new Command("ls")
  .description("List inbound emails")
  .option("--limit <value>", "limit")
  .option("--alias-email <value>", "alias_email")
  .option("--unread-only <value>", "unread_only")
  .option("--since <value>", "since")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
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

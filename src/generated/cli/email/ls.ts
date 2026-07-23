// AUTO-GENERATED — DO NOT EDIT (source: email_list)
import { Command } from "commander"
import { emailList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailListCommand = new Command("ls")
  .description("List inbound emails")
  .addHelpText("after", "\n### Overview\nRetrieves a paginated directory list of all inbound emails received by the user's active aliases, sorted in descending order of ingestion time (newest first).\n\n### When to Use\n- Use this endpoint to render mailbox dashboards or inbox streams.\n- Use query parameters to perform incremental syncs (via `since` timestamp) or to filter incoming mail by read state or target alias email.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Pagination**: Supports cursor-based pagination. Pass the returned `next_cursor` value back as the `cursor` query parameter to list subsequent pages. The `limit` is capped between 1 and 100, defaulting to 20.\n- By default, soft-deleted emails are hidden. Pass `include_deleted=true` to retrieve them.\n\n### Troubleshooting\n- **401 Unauthorized**: Missing, invalid, or expired Bearer token.\n- **400 Bad Request**: Malformed pagination cursor or invalid query parameters (e.g., non-integer limit).\n")
  .option("--limit <value>", "Max items to return (clamped to 1-100). Defaults to 20 server-side.")
  .option("--alias-email <value>", "If set, only return emails received on this full alias email address.")
  .option("--unread-only <value>", "When `true`, only return emails with `is_read=false`.")
  .option("--since <value>", "Unix epoch milliseconds — only return emails with `received_at >= since`. Useful for incremental sync.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .option("--include-deleted", "include_deleted")
  .action(async (opts) => {
    await runSdkCommand({
      operation: emailList,
      input: {
        query: {
          limit: opts.limit,
          alias_email: opts.aliasEmail,
          unread_only: opts.unreadOnly,
          since: opts.since,
          cursor: opts.cursor,
          include_deleted: opts.includeDeleted,
        },
      },
      context: { kind: "email_list", display: {"shape":"list","columns":["id","from_addr","subject","is_read","received_at"],"format":{"id":"id-short","from_addr":"truncate","subject":"truncate","is_read":"bool-badge","received_at":"relative-time"},"emptyMessage":"no emails"} },
    })
  })

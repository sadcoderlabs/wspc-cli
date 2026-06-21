// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_list)
import { Command } from "commander"
import { todoCommentList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const todoCommentListCommand = new Command("ls")
  .description("List comments on a todo")
  .argument("<id>", "id")
  .option("--order <value>", "order")
  .option("--include-deleted <value>", "include_deleted")
  .option("--limit <value>", "Max comments to return. Clamped to [1, 200]. Default 50 server-side.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "todo_comment_list", display: {"shape":"list","columns":["id","content","created_at"],"format":{"id":"id-short","content":"truncate","created_at":"relative-time"},"emptyMessage":"no comments"} }, (client) => todoCommentList({
      client,
      path: {
        id,
      },
      query: {
        order: opts.order,
        include_deleted: opts.includeDeleted,
        limit: opts.limit,
        cursor: opts.cursor,
      },
    }))
  })

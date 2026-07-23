// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_list)
import { Command } from "commander"
import { todoCommentList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const todoCommentListCommand = new Command("ls")
  .description("List comments on a todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nList the comments attached to a todo, oldest-first by default.\n\n### 💡 Key Features & Constraints\n* **Ordering**: Defaults to chronological (`asc`). Pass `order=desc` for newest-first.\n* **Soft-deleted**: Hidden by default; pass `include_deleted=true` to include them.\n* **Pagination**: Use `limit` (max 200, default 50) and `cursor` (the `next_cursor` from a previous response) to page through results. When `next_cursor` is absent in the response, you are on the last page. Returns `{ comments, next_cursor? }`. Changing `order` invalidates a cursor.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target todo does not exist or is soft-deleted.\n* **`VALIDATION_ERROR`**: Thrown if a cursor was produced with a different `order` than the current request.\n\nExamples:\n  $ wspc todo comment ls tod_01HW3K\n")
  .argument("<id>", "id")
  .option("--order <value>", "order")
  .option("--include-deleted <value>", "include_deleted")
  .option("--limit <value>", "Max comments to return. Clamped to [1, 200]. Default 50 server-side.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoCommentList,
      input: {
        path: {
          id,
        },
        query: {
          order: opts.order,
          include_deleted: opts.includeDeleted,
          limit: opts.limit,
          cursor: opts.cursor,
        },
      },
      context: { kind: "todo_comment_list", display: {"shape":"list","columns":["id","content","created_at"],"format":{"id":"id-short","content":"truncate","created_at":"relative-time"},"emptyMessage":"no comments"} },
    })
  })

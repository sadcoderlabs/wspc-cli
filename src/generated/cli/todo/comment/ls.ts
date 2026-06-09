// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_list)
import { Command } from "commander"
import { todoCommentList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const todoCommentListCommand = new Command("ls")
  .description("List comments on a todo")
  .argument("<id>", "id")
  .option("--order <value>", "order")
  .option("--include-deleted <value>", "include_deleted")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoCommentList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        order: opts.order,
        include_deleted: opts.includeDeleted,
        limit: opts.limit,
        cursor: opts.cursor,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_comment_list", display: {"shape":"list","columns":["id","content","created_at"],"format":{"id":"id-short","content":"truncate","created_at":"relative-time"},"emptyMessage":"no comments"} }, result.data)
  })

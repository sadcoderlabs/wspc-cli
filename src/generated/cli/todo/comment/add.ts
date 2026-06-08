// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_create)
import { Command } from "commander"
import { todoCommentCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const todoCommentCreateCommand = new Command("add")
  .description("Add a comment to a todo")
  .argument("<id>", "id")
  .argument("<content>", "content")
  .action(async (id, content, opts) => {
    const client = await loadSdkClient()
    const result = await todoCommentCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        content,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_comment_create", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","content":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

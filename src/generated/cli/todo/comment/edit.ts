// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_update)
import { Command } from "commander"
import { todoCommentUpdate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const todoCommentUpdateCommand = new Command("edit")
  .description("Edit a comment")
  .argument("<id>", "id")
  .argument("<content>", "content")
  .action(async (id, content, opts) => {
    await runSdkCommand({ kind: "todo_comment_update", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => todoCommentUpdate({
      client,
      path: {
        id,
      },
      body: {
        content,
      },
    }))
  })

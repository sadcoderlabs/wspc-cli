// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_create)
import { Command } from "commander"
import { todoCommentCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const todoCommentCreateCommand = new Command("add")
  .description("Add a comment to a todo")
  .argument("<id>", "id")
  .argument("<content>", "content")
  .action(async (id, content, opts) => {
    await runSdkCommand({ kind: "todo_comment_create", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => todoCommentCreate({
      client,
      path: {
        id,
      },
      body: {
        content,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_delete)
import { Command } from "commander"
import { todoCommentDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const todoCommentDeleteCommand = new Command("rm")
  .description("Soft-delete a comment")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "todo_comment_delete", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => todoCommentDelete({
      client,
      path: {
        id,
      },
    }))
  })

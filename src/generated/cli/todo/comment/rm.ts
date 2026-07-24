// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_delete)
import { Command } from "commander"
import { todoCommentDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const todoCommentDeleteCommand = new Command("rm")
  .description("Soft-delete a comment")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete a comment.\n\n### 💡 Key Features & Constraints\n* **Soft delete**: The comment is hidden from default listings but retained; there is no restore endpoint.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`COMMENT_NOT_FOUND` (HTTP 404)**: Thrown if the comment id is unknown, already deleted, or not in the caller's organization.\n\nExamples:\n  $ wspc todo comment rm tdc_01HW3K\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoCommentDelete,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "todo_comment_delete", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

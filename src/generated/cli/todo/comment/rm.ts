// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_delete)
import { Command } from "commander"
import { todoCommentDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const todoCommentDeleteCommand = new Command("rm")
  .description("Soft-delete a comment")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete a comment.\n\n### 💡 Key Features & Constraints\n* **Soft delete**: The comment is hidden from default listings but retained; there is no restore endpoint.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`COMMENT_NOT_FOUND` (HTTP 404)**: Thrown if the comment id is unknown, already deleted, or not in the caller's organization.\n\nExamples:\n  $ wspc todo comment rm tdc_01HW3K\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoCommentDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_comment_delete", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

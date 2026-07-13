// AUTO-GENERATED — DO NOT EDIT (source: todo_comment_create)
import { Command } from "commander"
import { todoCommentCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const todoCommentCreateCommand = new Command("add")
  .description("Add a comment to a todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nAttach a free-text comment to a todo. Use this to record progress updates, notes, or remarks as a task moves along.\n\n### 💡 Key Features & Constraints\n* **Free text**: Comments are plain text up to 10000 characters; there is no separate \"progress\" vs \"remark\" type.\n* **Authorship**: The author is recorded as the calling user (`user_id`).\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target todo does not exist or is soft-deleted.\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if content is empty or exceeds 10000 characters.\n\nExamples:\n  $ wspc todo comment add tod_01HW3K \"Verified on staging\"\n")
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
    render({ kind: "todo_comment_create", display: {"shape":"object","format":{"id":"id-short","todo_id":"id-short","user_id":"id-short","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

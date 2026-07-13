// AUTO-GENERATED — DO NOT EDIT (source: todo_type_restore)
import { Command } from "commander"
import { todoTypeRestore } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const todoTypeRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nRestore a previously archived/soft-deleted custom todo type.\n\n### 🔍 When to Use\n* Use this to bring a retired task category back into active status.\n\n### 💡 Key Features & Constraints\n* **Task Re-Attachment**: Restoring a type clears its `deleted_at` timestamp. Todo items previously assigned to this type immediately become active and validated under this recovered category schema.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target ID does not exist.\n\nExamples:\n  $ wspc todo type restore typ_xxx\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoTypeRestore({
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
    render({ kind: "todo_type_restore", display: undefined }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: todo_type_restore)
import { Command } from "commander"
import { todoTypeRestore } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const todoTypeRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nRestore a previously archived/soft-deleted custom todo type.\n\n### 🔍 When to Use\n* Use this to bring a retired task category back into active status.\n\n### 💡 Key Features & Constraints\n* **Task Re-Attachment**: Restoring a type clears its `deleted_at` timestamp. Todo items previously assigned to this type immediately become active and validated under this recovered category schema.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target ID does not exist.\n\nExamples:\n  $ wspc todo type restore typ_xxx\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoTypeRestore,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "todo_type_restore", display: undefined },
    })
  })

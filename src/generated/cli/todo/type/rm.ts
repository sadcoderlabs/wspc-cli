// AUTO-GENERATED — DO NOT EDIT (source: todo_type_delete)
import { Command } from "commander"
import { todoTypeDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const todoTypeDeleteCommand = new Command("rm")
  .description("Soft-delete a todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete/archive a custom todo type.\n\n### 🔍 When to Use\n* Use this to retire a custom task category workspace that is no longer needed.\n\n### 💡 Key Features & Constraints\n* **Default Type Protection**: The current active default type of a project cannot be deleted. You must assign another type as default first; otherwise the call fails with `CANNOT_DELETE_DEFAULT_TYPE`.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`CANNOT_DELETE_DEFAULT_TYPE` (HTTP 409)**: Thrown if the target todo type is currently the project's default type.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target ID does not exist.\n\nExamples:\n  $ wspc todo type rm typ_xxx\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoTypeDelete,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "todo_type_delete", display: undefined },
    })
  })

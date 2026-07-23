// AUTO-GENERATED — DO NOT EDIT (source: todo_type_list)
import { Command } from "commander"
import { todoTypeList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const todoTypeListCommand = new Command("ls")
  .description("List todo types")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nList custom todo types defined within a project.\n\n### 🔍 When to Use\n* Use this to populate task type selection dropdown elements or load category metadata for dynamic custom forms.\n\n### 💡 Key Features & Constraints\n* **Required Parameter**: The `project_id` filter is strictly required and must match an active project.\n* **Exclusion**: Soft-deleted types are excluded by default. Pass `include_deleted=true` to surface archived rows for a recovery UI.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if `project_id` query parameter is omitted.\n\nExamples:\n  $ wspc todo type ls\n")
  .option("--project-id <value>", "Project id filter. Required. Unknown, cross-organization, or soft-deleted project ids return NOT_FOUND.")
  .option("--user-id <value>", "user_id")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    await runSdkCommand({
      operation: todoTypeList,
      input: {
        query: {
          project_id: opts.projectId,
          user_id: opts.userId,
          include_deleted: opts.includeDeleted,
        },
      },
      context: { kind: "todo_type_list", display: {"shape":"list","columns":["id","label"],"format":{"id":"id-short","label":"truncate"},"emptyMessage":"no todo types"} },
    })
  })

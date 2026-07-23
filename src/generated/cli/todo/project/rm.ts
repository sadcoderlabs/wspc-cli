// AUTO-GENERATED — DO NOT EDIT (source: project_delete)
import { Command } from "commander"
import { projectDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const projectDeleteCommand = new Command("rm")
  .description("Soft-delete a project")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete/archive a project workspace.\n\n### 🔍 When to Use\n* Use this to archive a completed project and hide it from default listings without losing historical metrics.\n\n### 💡 Key Features & Constraints\n* **Cascading Effects**: Deleting a project automatically soft-deletes the project record and cascades to soft-delete all todos created under it.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the project ID does not exist or has already been archived.\n\nExamples:\n  $ wspc todo project rm prj_01HW3K\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: projectDelete,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "project_delete", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","creator_user_id":"id-short","default_todo_type_id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

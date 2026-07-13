// AUTO-GENERATED — DO NOT EDIT (source: project_delete)
import { Command } from "commander"
import { projectDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const projectDeleteCommand = new Command("rm")
  .description("Soft-delete a project")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete/archive a project workspace.\n\n### 🔍 When to Use\n* Use this to archive a completed project and hide it from default listings without losing historical metrics.\n\n### 💡 Key Features & Constraints\n* **Cascading Effects**: Deleting a project automatically soft-deletes the project record and cascades to soft-delete all todos created under it.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the project ID does not exist or has already been archived.\n\nExamples:\n  $ wspc todo project rm prj_01HW3K\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await projectDelete({
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
    render({ kind: "project_delete", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","creator_user_id":"id-short","default_todo_type_id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

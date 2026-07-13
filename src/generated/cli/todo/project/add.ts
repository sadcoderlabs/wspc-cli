// AUTO-GENERATED — DO NOT EDIT (source: project_create)
import { Command } from "commander"
import { projectCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const projectCreateCommand = new Command("add")
  .description("Create a project")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nEstablish a new isolated project workspace.\n\n### 🔍 When to Use\n* Use this to set up a new domain, team project, or separate workspace area to isolate tasks, custom types, and recurrence rules.\n\n### 💡 Key Features & Constraints\n* **Project Partitioning**: Projects act as strict boundaries. Custom todo types and recurrence rules created under this project are strictly confined to it.\n* **Name Uniqueness**: Project names are free-form and do not have to be unique.\n* **Default Type Inheritance**: Omit `default_todo_type_id` to automatically inherit the Default Project's default task type.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if required fields are missing, if name is empty, or if name length constraints are violated.\n\nExamples:\n  $ wspc todo project add \"Personal\"\n")
  .argument("<name>", "name")
  .option("--default-todo-type-id <value>", "default_todo_type_id")
  .action(async (name, opts) => {
    const client = await loadSdkClient()
    const result = await projectCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        name,
        default_todo_type_id: opts.defaultTodoTypeId,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "project_create", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","creator_user_id":"id-short","default_todo_type_id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

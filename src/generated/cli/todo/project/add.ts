// AUTO-GENERATED — DO NOT EDIT (source: project_create)
import { Command } from "commander"
import { projectCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const projectCreateCommand = new Command("add")
  .description("Create a project")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nEstablish a new isolated project workspace.\n\n### 🔍 When to Use\n* Use this to set up a new domain, team project, or separate workspace area to isolate tasks, custom types, and recurrence rules.\n\n### 💡 Key Features & Constraints\n* **Project Partitioning**: Projects act as strict boundaries. Custom todo types and recurrence rules created under this project are strictly confined to it.\n* **Name Uniqueness**: Project names do not have to be unique, but `Default Project` is reserved for the organization default project.\n* **Default Type Inheritance**: Omit `default_todo_type_id` to automatically inherit the Default Project's default task type.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if required fields are missing, if name is empty, if name length constraints are violated, or if the reserved `Default Project` name is used.\n\nExamples:\n  $ wspc todo project add \"Personal\"\n")
  .argument("<name>", "name")
  .option("--default-todo-type-id <value>", "default_todo_type_id")
  .action(async (name, opts) => {
    await runSdkCommand({
      operation: projectCreate,
      input: {
        body: {
          name,
          default_todo_type_id: opts.defaultTodoTypeId,
        },
      },
      context: { kind: "project_create", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","creator_user_id":"id-short","default_todo_type_id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

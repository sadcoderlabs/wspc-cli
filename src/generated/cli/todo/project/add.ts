// AUTO-GENERATED — DO NOT EDIT (source: project_create)
import { Command } from "commander"
import { projectCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const projectCreateCommand = new Command("add")
  .description("Create a project")
  .argument("<name>", "name")
  .option("--default-todo-type-id <value>", "default_todo_type_id")
  .action(async (name, opts) => {
    await runSdkCommand({ kind: "project_create", display: {"shape":"object","format":{"id":"id-short","org_id":"id-short","creator_user_id":"id-short","default_todo_type_id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => projectCreate({
      client,
      body: {
        name,
        default_todo_type_id: opts.defaultTodoTypeId,
      },
    }))
  })

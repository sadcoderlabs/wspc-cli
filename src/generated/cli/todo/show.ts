// AUTO-GENERATED — DO NOT EDIT (source: todo_get)
import { Command } from "commander"
import { todoGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const todoGetCommand = new Command("show")
  .description("Get a todo by id")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "include_deleted")
  .option("--include-orphan-fields <value>", "include_orphan_fields")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "todo_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => todoGet({
      client,
      path: {
        id,
      },
      query: {
        include_deleted: opts.includeDeleted,
        include_orphan_fields: opts.includeOrphanFields,
        include: "children,comments",
      },
    }))
  })

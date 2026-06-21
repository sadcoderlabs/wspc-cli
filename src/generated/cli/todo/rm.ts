// AUTO-GENERATED — DO NOT EDIT (source: todo_delete)
import { Command } from "commander"
import { todoDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const todoDeleteCommand = new Command("rm")
  .description("Soft-delete a todo")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--cascade <value>", "cascade")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "todo_delete", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => todoDelete({
      client,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        cascade: opts.cascade,
      },
    }))
  })

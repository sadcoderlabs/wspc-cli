// AUTO-GENERATED — DO NOT EDIT (source: todo_update)
import { Command } from "commander"
import { todoUpdate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"

export const todoUpdateCommand = new Command("update")
  .description("Update a todo")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--title <value>", "title")
  .option("--description <value>", "description")
  .option("--parent-id <value>", "parent_id")
  .option("--status <value>", "status")
  .option("--due-at <value>", "due_at")
  .option("--type-id <value>", "type_id")
  .option("--custom-fields <value>", "custom_fields")
  .option("--user-id <value>", "user_id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        title: opts.title,
        description: opts.description,
        parent_id: opts.parentId,
        status: opts.status,
        due_at: opts.dueAt,
        type_id: opts.typeId,
        custom_fields: opts.customFields,
        user_id: opts.userId,
      },
    })
    console.log(JSON.stringify(result.data, null, 2))
  })

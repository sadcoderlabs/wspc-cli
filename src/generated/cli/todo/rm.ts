// AUTO-GENERATED — DO NOT EDIT (source: todo_delete)
import { Command } from "commander"
import { todoDelete } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"

export const todoDeleteCommand = new Command("rm")
  .description("Soft-delete a todo")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--cascade <value>", "cascade")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        cascade: opts.cascade,
      },
    })
    console.log(JSON.stringify(result.data, null, 2))
  })

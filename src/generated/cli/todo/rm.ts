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
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    if (result.data !== undefined) console.log(JSON.stringify(result.data, null, 2))
  })

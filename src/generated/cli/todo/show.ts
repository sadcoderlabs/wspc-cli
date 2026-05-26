// AUTO-GENERATED — DO NOT EDIT (source: todo_get)
import { Command } from "commander"
import { todoGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"

export const todoGetCommand = new Command("show")
  .description("Get a todo by id")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        include_deleted: opts.includeDeleted,
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

// AUTO-GENERATED — DO NOT EDIT (source: todo_type_list)
import { Command } from "commander"
import { todoTypeList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"

export const todoTypeListCommand = new Command("ls")
  .description("List todo types")
  .option("--project-id <value>", "project_id")
  .option("--user-id <value>", "user_id")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await todoTypeList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        project_id: opts.projectId,
        user_id: opts.userId,
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

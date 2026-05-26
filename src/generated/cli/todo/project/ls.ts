// AUTO-GENERATED — DO NOT EDIT (source: project_list)
import { Command } from "commander"
import { projectList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"

export const projectListCommand = new Command("ls")
  .description("List projects")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await projectList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        include_deleted: opts.includeDeleted,
      },
    })
    console.log(JSON.stringify(result.data, null, 2))
  })

// AUTO-GENERATED — DO NOT EDIT (source: project_list)
import { Command } from "commander"
import { projectList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const projectListCommand = new Command("ls")
  .description("List projects")
  .option("--include-deleted <value>", "Set to `true` to include soft-deleted projects in the response.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "project_list", display: {"shape":"list","columns":["id","name","default_todo_type_id"],"format":{"id":"id-short","name":"truncate","default_todo_type_id":"id-short"},"emptyMessage":"no projects"} }, (client) => projectList({
      client,
      query: {
        include_deleted: opts.includeDeleted,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: todo_type_list)
import { Command } from "commander"
import { todoTypeList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const todoTypeListCommand = new Command("ls")
  .description("List todo types")
  .option("--project-id <value>", "Project id filter. Required. Unknown, cross-organization, or soft-deleted project ids return NOT_FOUND.")
  .option("--user-id <value>", "user_id")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    await runSdkCommand({ kind: "todo_type_list", display: {"shape":"list","columns":["id","label"],"format":{"id":"id-short","label":"truncate"},"emptyMessage":"no todo types"} }, (client) => todoTypeList({
      client,
      query: {
        project_id: opts.projectId,
        user_id: opts.userId,
        include_deleted: opts.includeDeleted,
      },
    }))
  })

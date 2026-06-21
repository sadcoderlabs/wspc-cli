// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_list)
import { Command } from "commander"
import { recurrenceRuleList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const recurrenceRuleListCommand = new Command("ls")
  .description("List recurring todo rules")
  .option("--project-id <value>", "Project id filter. Required. Unknown, cross-organization, or soft-deleted project ids return NOT_FOUND.")
  .option("--user-id <value>", "user_id")
  .action(async (opts) => {
    await runSdkCommand({ kind: "recurrence_rule_list", display: {"shape":"list","columns":["id","rrule","dtstart","type_id"],"format":{"id":"id-short","rrule":"truncate","type_id":"id-short"},"emptyMessage":"no recurrence rules"} }, (client) => recurrenceRuleList({
      client,
      query: {
        project_id: opts.projectId,
        user_id: opts.userId,
      },
    }))
  })

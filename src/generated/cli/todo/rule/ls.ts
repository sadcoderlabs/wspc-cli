// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_list)
import { Command } from "commander"
import { recurrenceRuleList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"

export const recurrenceRuleListCommand = new Command("ls")
  .description("List recurring todo rules")
  .option("--project-id <value>", "project_id")
  .option("--user-id <value>", "user_id")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await recurrenceRuleList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        project_id: opts.projectId,
        user_id: opts.userId,
      },
    })
    console.log(JSON.stringify(result.data, null, 2))
  })

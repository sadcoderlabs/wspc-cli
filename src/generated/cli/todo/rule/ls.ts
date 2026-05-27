// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_list)
import { Command } from "commander"
import { recurrenceRuleList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

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
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "recurrence_rule_list", display: {"shape":"list","columns":["id","rrule","dtstart"],"format":{"id":"id-short","rrule":"truncate"},"emptyMessage":"no recurrence rules"} }, result.data)
  })

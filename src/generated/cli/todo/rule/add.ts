// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_create)
import { Command } from "commander"
import { recurrenceRuleCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleCreateCommand = new Command("add")
  .description("Create a recurring todo rule")
  .argument("<title>", "title")
  .option("--rrule <value>", "rrule")
  .option("--dtstart <value>", "dtstart")
  .option("--description <value>", "description")
  .option("--parent-id <value>", "parent_id")
  .option("-p, --project <value>", "Project for the recurrence rule, its template todo, and all materialized instances. Must be an active project in the caller's organization.")
  .option("-t, --type <value>", "type_id")
  .action(async (title, opts) => {
    const client = await loadSdkClient()
    const result = await recurrenceRuleCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        title,
        rrule: opts.rrule,
        dtstart: opts.dtstart,
        description: opts.description,
        parent_id: opts.parentId,
        project_id: opts.project,
        type_id: opts.type,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "recurrence_rule_create", display: undefined }, result.data)
  })

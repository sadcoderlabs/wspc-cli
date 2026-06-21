// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_create)
import { Command } from "commander"
import { recurrenceRuleCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

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
    await runSdkCommand({ kind: "recurrence_rule_create", display: undefined }, (client) => recurrenceRuleCreate({
      client,
      body: {
        title,
        rrule: opts.rrule,
        dtstart: opts.dtstart,
        description: opts.description,
        parent_id: opts.parentId,
        project_id: opts.project,
        type_id: opts.type,
      },
    }))
  })

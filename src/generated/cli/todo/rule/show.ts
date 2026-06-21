// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_get)
import { Command } from "commander"
import { recurrenceRuleGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const recurrenceRuleGetCommand = new Command("show")
  .description("Get a recurring todo rule")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "recurrence_rule_get", display: {"shape":"object","format":{"id":"id-short","type_id":"id-short"}} }, (client) => recurrenceRuleGet({
      client,
      path: {
        id,
      },
    }))
  })

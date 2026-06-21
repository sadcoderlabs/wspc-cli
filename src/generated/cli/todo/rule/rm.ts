// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_delete)
import { Command } from "commander"
import { recurrenceRuleDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const recurrenceRuleDeleteCommand = new Command("rm")
  .description("Delete a recurring todo rule")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "recurrence_rule_delete", display: undefined }, (client) => recurrenceRuleDelete({
      client,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    }))
  })

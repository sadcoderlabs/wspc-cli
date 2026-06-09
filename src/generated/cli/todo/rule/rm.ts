// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_delete)
import { Command } from "commander"
import { recurrenceRuleDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleDeleteCommand = new Command("rm")
  .description("Delete a recurring todo rule")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await recurrenceRuleDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "recurrence_rule_delete", display: undefined }, result.data)
  })

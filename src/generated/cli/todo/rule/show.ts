// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_get)
import { Command } from "commander"
import { recurrenceRuleGet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleGetCommand = new Command("show")
  .description("Get a recurring todo rule")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await recurrenceRuleGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "recurrence_rule_get", display: {"shape":"object","format":{"id":"id-short","type_id":"id-short"}} }, result.data)
  })

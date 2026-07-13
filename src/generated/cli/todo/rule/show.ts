// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_get)
import { Command } from "commander"
import { recurrenceRuleGet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleGetCommand = new Command("show")
  .description("Get a recurring todo rule")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nFetch a single recurrence rule along with its template todo snapshot and the count of materialized instances.\n\n### 🔍 When to Use\n* Use this to inspect rule details before editing, preview the task template that future occurrences will copy, or check the current materialization metrics.\n\n### 💡 Key Features & Constraints\n* **Snapshot Integrity**: The returned template represents a schema template snapshot — modifying the rule (PATCH) only alters future occurrences; already-materialized tasks are never mutated retroactively.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the specified rule ID does not exist.\n\nExamples:\n  $ wspc todo rule show tdr_xxx\n")
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

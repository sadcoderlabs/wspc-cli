// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_delete)
import { Command } from "commander"
import { recurrenceRuleDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleDeleteCommand = new Command("rm")
  .description("Delete a recurring todo rule")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete/delete a recurrence rule to immediately halt future task materialization.\n\n### 🔍 When to Use\n* Use this to permanently end an ongoing cyclical schedule automation (e.g., when a weekly standby rotation is retired).\n\n### 💡 Key Features & Constraints\n* **Historic Preservation**: Deleting a rule stops the rolling schedule generations, but **does not** delete or alter todo tasks that have already been materialized. They remain on the user's list.\n* **Optimistic Locking**: Supports optional `expected_version` checks.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VERSION_CONFLICT` (HTTP 409)**: Thrown if `expected_version` mismatches the database.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target rule ID does not exist.\n\nExamples:\n  $ wspc todo rule rm tdr_xxx\n  $ wspc todo rule rm tdr_xxx --expected-version 3\n")
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

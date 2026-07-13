// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_list)
import { Command } from "commander"
import { recurrenceRuleList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleListCommand = new Command("ls")
  .description("List recurring todo rules")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nReturn all active recurrence rules within a specific project owned by the caller.\n\n### 🔍 When to Use\n* Use this to render rule management panels, list scheduled automation templates, or inspect active rules.\n\n### 💡 Key Features & Constraints\n* **Project Scope**: The `project_id` query parameter is strictly required.\n* **Exclusion**: Soft-deleted/archived rules are excluded from the response by default.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if `project_id` query filter is omitted.\n\nExamples:\n  $ wspc todo rule ls\n")
  .option("--project-id <value>", "Project id filter. Required. Unknown, cross-organization, or soft-deleted project ids return NOT_FOUND.")
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
    render({ kind: "recurrence_rule_list", display: {"shape":"list","columns":["id","rrule","dtstart","type_id"],"format":{"id":"id-short","rrule":"truncate","type_id":"id-short"},"emptyMessage":"no recurrence rules"} }, result.data)
  })

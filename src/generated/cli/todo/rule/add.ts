// AUTO-GENERATED — DO NOT EDIT (source: recurrence_rule_create)
import { Command } from "commander"
import { recurrenceRuleCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const recurrenceRuleCreateCommand = new Command("add")
  .description("Create a recurring todo rule")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nCreate a recurrence rule that materializes upcoming todo instances on a repeating schedule.\n\n### 🔍 When to Use\n* Use this to set up recurring work like a weekly Standup, monthly reporting, or cyclical maintenance. The server automatically materializes upcoming todo instances on a 14-day rolling horizon.\n\n### 💡 Key Features & Constraints\n* **RFC-5545 Conformity**: The `rrule` parameter must be a valid RFC-5545 schedule string (e.g., `FREQ=WEEKLY;BYDAY=MO`) and must **not** include the `DTSTART` or `TZID` directive.\n* **Anchor Date**: `dtstart` specifies the local calendar starting date (`YYYY-MM-DD`) where the schedule rule is anchored.\n* **Nesting Constraints**: Recurrence rules can only be bound to root-level tasks. Child tasks (subtasks) cannot have recurrence rules. Setting a child task as a parent will trigger `PARENT_IS_CHILD`.\n* **Instance Independence**: Once materialized, each todo instance is fully independent with its own `status` and `due_at`.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`RRULE_INVALID` (HTTP 400)**: Thrown if the `rrule` schedule string is broken or contains illegal `DTSTART` directives.\n* **`PARENT_IS_CHILD` (HTTP 400)**: Thrown if the specified `parent_id` points to a child task.\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if date format is invalid or required fields are missing.\n\nExamples:\n  $ wspc todo rule add \"Weekly review\" --rrule \"FREQ=WEEKLY;BYDAY=MO\" --dtstart 2026-05-18 --project prj_xxx\n  $ wspc todo rule add \"Weekly review\" --rrule \"FREQ=WEEKLY;BYDAY=MO\" --dtstart 2026-05-18 --project prj_xxx --type typ_xxx\n")
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

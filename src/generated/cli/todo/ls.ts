// AUTO-GENERATED — DO NOT EDIT (source: todo_list)
import { Command } from "commander"
import { todoList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoListCommand = new Command("ls")
  .description("List todos with filters")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nReturn the caller's active or archived todos, with comprehensive options to filter by project, parent task, status, due-date window, and template visibility.\n\n### 🔍 When to Use\n* Use this to render the main todo board dashboard, query items due in a specific timeframe (using `due_after` and `due_before`), or lazy-load subtasks for an expanded parent todo by passing its ID.\n\n### 💡 Key Features & Constraints\n* **Required Parameter**: The `project_id` query parameter is strictly required and must match an active project.\n* **Parent Tasks**: Omitting `parent_id` lists root-level todos by default. Pass a todo id to list direct children of that specific task.\n* **Multi-Status Filters**: Multi-value `status` query is supported by repeating the parameter, e.g., `?status=open&status=in_progress`.\n* **Due-Date Windowing**: The `due_after` filter is inclusive, while `due_before` is exclusive, forming a half-open window `[due_after, due_before)`. Both parameters exclude todos with no due date.\n* **Template & Soft-Delete Visibility**: Soft-deleted todos are hidden unless `include_deleted=true`. Template todos backing recurrence rules are hidden unless `include_templates=true`.\n* **Custom-Field Filters (`cf.<key>=<value>`)**: Repeatable dynamic-prefix query parameters whose name follows the `cf.<key>` pattern (e.g. `?cf.priority=high&cf.team=eng`). Each pair is ANDed; for `string_array` custom fields the match is positive when the array contains the value. Keys must be declared on the project's todo type schema. Because the prefix is dynamic, these parameters cannot be expressed in the JSON Schema below — clients must construct them from the URL query string directly.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if `project_id` is missing, or if query parameters fail schema validation.\n\nExamples:\n  $ wspc todo ls\n  $ wspc todo ls --status open\n  $ wspc todo ls --project prj_xxx\n")
  .option("-p, --project <value>", "Filter by project. Required. Unknown, cross-organization, or soft-deleted project ids return NOT_FOUND.")
  .option("--user-id <value>", "user_id")
  .option("--parent-id <value>", "parent_id")
  .option("-s, --status <value>", "status")
  .option("--include-deleted", "include_deleted")
  .option("--include-templates <value>", "include_templates")
  .option("--due-after <value>", "due_after")
  .option("--due-before <value>", "due_before")
  .option("--type-id <value>", "type_id")
  .option("--sort-by <value>", "sort_by")
  .option("--order <value>", "order")
  .option("--include-orphan-fields <value>", "include_orphan_fields")
  .option("--limit <value>", "Max todos to return. Clamped to [1, 200]. Default 50 server-side.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await todoList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        project_id: opts.project,
        user_id: opts.userId,
        parent_id: opts.parentId,
        status: opts.status,
        include_deleted: opts.includeDeleted,
        include_templates: opts.includeTemplates,
        due_after: opts.dueAfter,
        due_before: opts.dueBefore,
        type_id: opts.typeId,
        sort_by: opts.sortBy,
        order: opts.order,
        include_orphan_fields: opts.includeOrphanFields,
        limit: opts.limit,
        cursor: opts.cursor,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_list", display: {"shape":"list","columns":["id","status","title","due_at"],"format":{"id":"id-short","status":"status-badge","title":"truncate","due_at":"relative-time"},"emptyMessage":"no todos"} }, result.data)
  })

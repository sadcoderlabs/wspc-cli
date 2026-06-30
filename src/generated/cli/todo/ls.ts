// AUTO-GENERATED — DO NOT EDIT (source: todo_list)
import { Command } from "commander"
import { todoList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoListCommand = new Command("ls")
  .description("List todos with filters")
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

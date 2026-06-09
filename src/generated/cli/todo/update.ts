// AUTO-GENERATED — DO NOT EDIT (source: todo_update)
import { Command } from "commander"
import { todoUpdate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoUpdateCommand = new Command("update")
  .description("Update a todo")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--title <value>", "New title. Omit to leave the existing title unchanged. Must be non-empty when supplied.")
  .option("--description <value>", "New description. Markdown formatted (CommonMark + GFM tables, strikethrough, task lists). Pass empty string `\"\"` explicitly to clear an existing description, or omit to leave unchanged. Passing `null` is strictly rejected.")
  .option("--parent-id <value>", "Re-parent the todo. Pass a valid parent ID to attach under another todo, pass `null` to move it back to the root level, or omit to leave unchanged. Nesting is limited to one level; attempting to set a child todo as a parent will trigger `PARENT_IS_CHILD`.")
  .option("--status <value>", "New status of the todo. Allowed transitions: `open` ➔ `in_progress` ➔ `done`. `cancelled` represents a terminal state. Transitioning to `done` automatically emits a `captureTodoCompleted` analytics event. Omit to leave the existing status unchanged.")
  .option("--due-at <value>", "Update calendar due date in ISO date-only format (`YYYY-MM-DD`). Pass `\"\"` explicitly to clear an existing due date, or omit to leave it unchanged. Passing `null` is strictly rejected.")
  .option("--type-id <value>", "Re-assign this todo to a different active type. The new type must belong to the todo's same project; otherwise the request fails with TYPE_PROJECT_MISMATCH. New server-generated type ids use typ_<ULID>; legacy ids remain accepted.")
  .option("--custom-fields <value>", "PATCH semantics: only the keys present in this map change. Pass `null` for a key (e.g. `custom_fields: { priority: null }`) to explicitly delete that custom field value. Array values are replaced wholesale with no element-level diff. Providing a key that is not declared on the effective todo type is rejected with `UNDECLARED_FIELD`.")
  .option("--user-id <value>", "Reassign the owner (assignee) user ID of this todo. Target user must belong to the same organization.")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        title: opts.title,
        description: opts.description,
        parent_id: opts.parentId,
        status: opts.status,
        due_at: opts.dueAt,
        type_id: opts.typeId,
        custom_fields: opts.customFields,
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
    render({ kind: "todo_update", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

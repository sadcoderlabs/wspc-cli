// AUTO-GENERATED — DO NOT EDIT (source: todo_update)
import { Command } from "commander"
import { todoUpdate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { parseJsonField } from "../../../handwritten/utils/parse-json-field.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const todoUpdateCommand = new Command("update")
  .description("Update a todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nUpdate one or more fields of an existing todo item, such as its title, status, parent todo, due date, or description.\n\n### 🔍 When to Use\n* Use this to log progress by changing the status (e.g., to `in_progress` or `done`), reschedule due dates, edit title/description, or reassign/move a task by changing its `parent_id`.\n\n### 💡 Key Features & Constraints\n* **Optimistic Locking (`expected_version`)**: An optional integer representing the version you expect to update. If provided, the server matches it with the current database version. If they match, the update succeeds and increments the version; if they mismatch, a `VERSION_CONFLICT` error is thrown. Omit this field to skip version checking (Last-Write-Wins behavior).\n* **Parent Re-assignment**: Set `parent_id: null` to move a child todo back to the root level.\n* **Status Transitions**: Transitioning the `status` to `done` automatically emits a `captureTodoCompleted` analytics event.\n* **Clearing Fields**: To clear an existing description or due date, explicitly pass `\"\"`. Passing `null` is rejected.\n\n### 💡 Best Practices & Guidelines\n* **Enriched Context**: Keep the description updated with definition of done, relevant progress notes, or resolution summaries.\n* **Keep Descriptions Clean**: Delegate heavy logs/documents to a Markdown file on Drive, and put a markdown link inside the description.\n* **Structured Properties**: Use custom fields (`custom_fields`) matching the todo's type to record properties like tags, priority, or severity.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VERSION_CONFLICT` (HTTP 409)**: Thrown if `expected_version` does not match the current database row version.\n* **`PARENT_IS_CHILD` (HTTP 400)**: Thrown if the new `parent_id` refers to a todo that is itself already a child todo.\n* **`WOULD_CREATE_CYCLE` (HTTP 400)**: Thrown if the update attempts to make a parent todo a child of its own descendant.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the todo `id` or the new `parent_id` does not exist or has been soft-deleted.\n\nExamples:\n  $ wspc todo update tod_xxx --status done\n  $ wspc todo update tod_xxx --title \"New title\"\n  $ wspc todo update tod_xxx --custom-fields '{\"severity\":\"critical\"}'\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--title <value>", "New title. Omit to leave the existing title unchanged. Must be non-empty when supplied.")
  .option("--description <value>", "New description. Markdown formatted (CommonMark + GFM tables, strikethrough, task lists). Pass empty string `\"\"` explicitly to clear an existing description, or omit to leave unchanged. Passing `null` is strictly rejected.")
  .option("--parent-id <value>", "Re-parent the todo. Pass a valid parent ID to attach under another todo, pass `null` to move it back to the root level, or omit to leave unchanged. Nesting is limited to one level; attempting to set a child todo as a parent will trigger `PARENT_IS_CHILD`.")
  .option("--status <value>", "New status of the todo. Allowed transitions: `open` ➔ `in_progress` ➔ `done`. `cancelled` represents a terminal state. Transitioning to `done` automatically emits a `captureTodoCompleted` analytics event. Omit to leave the existing status unchanged.")
  .option("--due-at <value>", "Update calendar due date in ISO date-only format (`YYYY-MM-DD`). Pass `\"\"` explicitly to clear an existing due date, or omit to leave it unchanged. Passing `null` is strictly rejected.")
  .option("--type-id <value>", "Re-assign this todo to a different active type. The new type must belong to the todo's same project; otherwise the request fails with TYPE_PROJECT_MISMATCH. New server-generated type ids use typ_<ULID>; legacy ids remain accepted.")
  .option("--custom-fields <value>", "PATCH semantics: only the keys present in this map change. Pass `null` for a key (e.g. `custom_fields: { priority: null }`) to explicitly delete that custom field value. Array values are replaced wholesale with no element-level diff. Providing a key that is not declared on the effective todo type is rejected with `UNDECLARED_FIELD`.")
  .option("--user-id <value>", "Reassign the owner (assignee) user ID of this todo. Target user must belong to the same organization.")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoUpdate,
      input: {
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
          custom_fields: parseJsonField(opts.customFields, "custom-fields"),
          user_id: opts.userId,
        },
      },
      context: { kind: "todo_update", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

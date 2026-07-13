// AUTO-GENERATED — DO NOT EDIT (source: todo_create)
import { Command } from "commander"
import { todoCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseJsonField } from "../../../handwritten/utils/parse-json-field.js"

export const todoCreateCommand = new Command("add")
  .description("Create a todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nCreate a new todo item under a specified project. This can either be a standalone root-level todo or a nested subtask attached to an existing root todo.\n\n### 🔍 When to Use\n* Use this to capture a fresh work item, document an ongoing task, or break a larger root todo into subtasks by creating child todos under it.\n\n### 💡 Key Features & Constraints\n* **One-Level Nesting Limit**: WSPC supports a maximum of one level of task nesting (Root ➔ Child). A root-level todo can have children, but a child todo cannot have further subtasks. Setting a child todo as a parent will fail and trigger a `PARENT_IS_CHILD` error.\n* **Description Handling**: Passing a non-empty string stores the description; passing `\"\"` explicitly stores an empty string. Passing `null` is strictly rejected.\n* **Due Date Format**: Accepts an ISO-8601 date-only format (`YYYY-MM-DD`). Pass `\"\"` or omit the field to skip setting a due date.\n* **Project Binding**: Every todo must belong to a valid active project (`project_id`).\n\n### 💡 Best Practices & Guidelines\n* **Descriptive Descriptions**: Always provide a detailed description explaining the task's context, goal, or definition of done. Avoid leaving it empty.\n* **Task Breakdown**: For complex items, split the task into 2-3 logical subtasks (by passing a parent todo ID in `parent_id`). Remember WSPC supports only one level of nesting (Root -> Child).\n* **Integration with Drive**: If a task requires storing large text blocks, research logs, checklists, or files, do not overload the description. Use the Drive feature to store a markdown file (e.g., `research/notes.md`) and place a clean reference link in the description, such as `[Notes](drive://<library>/<path>)`.\n* **Structured Properties (Custom Fields)**: Avoid putting structured meta-attributes (like priority, severity, story points, tags) directly in the description. Instead, use custom todo types (`todo_type`). Create a custom type schema first, then assign it with `type_id` and pass values via `custom_fields`.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if required fields are missing, if `due_at` violates the `YYYY-MM-DD` format, or if `title` exceeds 500 characters.\n* **`PARENT_IS_CHILD` (HTTP 400)**: Thrown if the target `parent_id` refers to a todo that is itself already a child todo.\n* **`WOULD_CREATE_CYCLE` (HTTP 400)**: Thrown if `parent_id` points to the todo's own ID.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the specified `project_id` or `parent_id` does not exist or has been soft-deleted.\n\nExamples:\n  $ wspc todo add \"Buy milk\"\n  $ wspc todo add \"Buy milk\" --project prj_xxx\n  $ wspc todo add \"Fix styling issue\" --type-id typ_xxx --custom-fields '{\"severity\":\"high\",\"tags\":[\"ui\"]}'\n")
  .argument("<title>", "title")
  .option("-p, --project <value>", "Project id to assign this todo to. It must be an active project in the caller's organization.")
  .option("--description <value>", "Free-form details about the todo. Fully supports GFM Markdown (tables, strikethrough, task lists). Stored verbatim; client applications are responsible for rendering. Optional. Passing `null` is strictly rejected.")
  .option("--parent-id <value>", "Parent todo ID (`tod_<ULID>`) to attach this todo as a child under another todo. Omit or pass `null` to create a root-level todo. Nesting is limited to one level; attempting to set a child todo as a parent will trigger `PARENT_IS_CHILD`. To make a subtask appear on every occurrence of a recurring rule, set this to that rule's template todo id (the template id returned when the rule is created); the server re-materializes future occurrences so each carries the subtask.")
  .option("--status <value>", "Initial status of the todo. Omit to default to `open`. Allowed values: `open`, `in_progress`, `done`, `cancelled`.")
  .option("--due-at <value>", "Optional calendar due date in ISO date-only format (`YYYY-MM-DD`). Stored without timezone offsets to represent the same local calendar day globally. Pass `\"\"` or omit the field to skip setting a due date. Passing `null` is strictly rejected.")
  .option("--idempotency-key <value>", "idempotency_key")
  .option("--type-id <value>", "Type id this todo belongs to. Omit to use the project's default type. When project_id is also supplied, the type must belong to the same project. New server-generated type ids use typ_<ULID>; legacy ids remain accepted.")
  .option("--custom-fields <value>", "Custom field values keyed by the field's immutable `key` (not the human `label`). Each value must match the declared field type: string fields require string values, and string_array fields require string arrays. Providing a key that is not declared on the resolved todo type is strictly rejected with `UNDECLARED_FIELD`. Missing required fields that lack a default value are rejected with `FIELD_REQUIRED`. Defaults declared on the type are auto-applied at create time.")
  .action(async (title, opts) => {
    const client = await loadSdkClient()
    const result = await todoCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        title,
        project_id: opts.project,
        description: opts.description,
        parent_id: opts.parentId,
        status: opts.status,
        due_at: opts.dueAt,
        idempotency_key: opts.idempotencyKey,
        type_id: opts.typeId,
        custom_fields: parseJsonField(opts.customFields, "custom-fields"),
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

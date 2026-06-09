// AUTO-GENERATED — DO NOT EDIT (source: todo_create)
import { Command } from "commander"
import { todoCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoCreateCommand = new Command("add")
  .description("Create a todo")
  .argument("<title>", "title")
  .option("-p, --project <value>", "Project id to assign this todo to. It must be an active project in the caller's organization.")
  .option("--description <value>", "Free-form details about the todo. Fully supports GFM Markdown (tables, strikethrough, task lists). Stored verbatim; client applications are responsible for rendering. Optional. Passing `null` is strictly rejected.")
  .option("--parent-id <value>", "Parent todo ID (`tod_<ULID>`) to attach this todo as a child under another todo. Omit or pass `null` to create a root-level todo. Nesting is limited to one level; attempting to set a child todo as a parent will trigger `PARENT_IS_CHILD`.")
  .option("--status <value>", "Initial status of the todo. Omit to default to `open`. Allowed values: `open`, `in_progress`, `done`, `cancelled`.")
  .option("--due-at <value>", "Optional calendar due date in ISO date-only format (`YYYY-MM-DD`). Stored without timezone offsets to represent the same local calendar day globally. Pass `\"\"` or omit the field to skip setting a due date. Passing `null` is strictly rejected.")
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
        type_id: opts.typeId,
        custom_fields: opts.customFields,
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

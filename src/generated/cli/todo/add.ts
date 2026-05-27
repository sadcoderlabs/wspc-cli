// AUTO-GENERATED — DO NOT EDIT (source: todo_create)
import { Command } from "commander"
import { todoCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoCreateCommand = new Command("add")
  .description("Create a todo")
  .argument("<title>", "title")
  .option("-p, --project <value>", "project_id")
  .option("--description <value>", "description")
  .option("--parent-id <value>", "parent_id")
  .option("--status <value>", "status")
  .option("--due-at <value>", "due_at")
  .option("--type-id <value>", "type_id")
  .option("--custom-fields <value>", "custom_fields")
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
    render({ kind: "todo_create", display: {"shape":"object"} }, result.data)
  })

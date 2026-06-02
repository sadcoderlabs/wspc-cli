// AUTO-GENERATED — DO NOT EDIT (source: todo_get)
import { Command } from "commander"
import { todoGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoGetCommand = new Command("show")
  .description("Get a todo by id")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "include_deleted")
  .option("--include-orphan-fields <value>", "include_orphan_fields")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        include_deleted: opts.includeDeleted,
        include_orphan_fields: opts.includeOrphanFields,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","title":"truncate","description":"truncate","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

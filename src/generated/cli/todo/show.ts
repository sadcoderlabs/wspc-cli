// AUTO-GENERATED — DO NOT EDIT (source: todo_get)
import { Command } from "commander"
import { todoGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoGetCommand = new Command("show")
  .description("Get a todo by id")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nFetch the full details of a single todo item by its unique identifier.\n\n### 🔍 When to Use\n* Use this to confirm the current state of a task, inspect nested field values, or retrieve its current `version` before issuing an optimistic update (PATCH).\n\n### 💡 Key Features & Constraints\n* **Soft-Deleted Recovery**: A soft-deleted todo will return an HTTP 404 unless the query parameter `?include_deleted=true` is explicitly supplied.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the specified todo `id` does not exist, or has been soft-deleted and the request did not supply `include_deleted=true`.\n\nExamples:\n  $ wspc todo show tod_xxx\n")
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
        include: "children,comments",
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

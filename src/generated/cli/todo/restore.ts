// AUTO-GENERATED — DO NOT EDIT (source: todo_restore)
import { Command } from "commander"
import { todoRestore } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseIntegerField, parseBooleanField } from "../../../handwritten/utils/parse-scalar-field.js"

export const todoRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nReverse a previous soft-delete. The todo (and optionally its descendants) is recovered back to the active list.\n\n### 🔍 When to Use\n* Use this to recover a task deleted by mistake, or pull a task out of the trash to continue active work.\n\n### 💡 Key Features & Constraints\n* **Orphan Warning**: If the restored todo's parent is still in the trash, the call succeeds but returns `parent_in_trash_warning: true`, signaling that the restored todo is currently orphaned from a visible ancestor.\n* **Cascading Restore (`cascade`)**: If `cascade: true` is provided, all descendants still in the trash are also restored. Otherwise, descendants are left in the trash, and their count is reported back in `descendants_in_trash_count`.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VERSION_CONFLICT` (HTTP 409)**: Thrown if `expected_version` is supplied and mismatches the database.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target todo `id` does not exist or has already been permanently purged.\n\nExamples:\n  $ wspc todo restore tod_xxx\n  $ wspc todo restore tod_xxx --cascade\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--cascade <value>", "cascade", (value: string) => parseBooleanField(value, "cascade"))
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoRestore({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        cascade: opts.cascade,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_restore", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

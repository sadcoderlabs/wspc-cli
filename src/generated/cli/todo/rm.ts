// AUTO-GENERATED — DO NOT EDIT (source: todo_delete)
import { Command } from "commander"
import { todoDelete } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseIntegerField, parseBooleanField } from "../../../handwritten/utils/parse-scalar-field.js"

export const todoDeleteCommand = new Command("rm")
  .description("Soft-delete a todo")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nSoft-delete a todo item so that it no longer appears in active list queries. The record remains in the database and can be recovered later.\n\n### 🔍 When to Use\n* Use this to hide an item from your active listings without permanently losing the history or metrics.\n\n### 💡 Key Features & Constraints\n* **Cascading Delete (`cascade`)**: If the target todo has active child subtasks:\n  - If `cascade: false` (default), the deletion will fail and throw a `HAS_CHILDREN` error to prevent accidental orphaned tasks.\n  - If `cascade: true`, the target todo and all its nested child subtasks will be soft-deleted together.\n* **Optimistic Locking**: You may optionally pass `expected_version` to ensure the todo has not been modified since you last read it.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`HAS_CHILDREN` (HTTP 400)**: Thrown if you attempt to delete a parent todo that has active subtasks without explicitly setting `cascade: true`.\n* **`VERSION_CONFLICT` (HTTP 409)**: Thrown if `expected_version` is provided and mismatches the database.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target todo `id` does not exist or has already been soft-deleted.\n\nExamples:\n  $ wspc todo rm tod_xxx\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--cascade <value>", "cascade", (value: string) => parseBooleanField(value, "cascade"))
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoDelete({
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
    render({ kind: "todo_delete", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","project_id":"id-short","parent_id":"id-short","type_id":"id-short","status":"status-badge","due_at":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

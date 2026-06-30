// AUTO-GENERATED — DO NOT EDIT (source: todo_restore)
import { Command } from "commander"
import { todoRestore } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const todoRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted todo")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--cascade <value>", "cascade")
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

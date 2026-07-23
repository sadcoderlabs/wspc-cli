// AUTO-GENERATED — DO NOT EDIT (source: event_restore)
import { Command } from "commander"
import { eventRestore } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const eventRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted event")
  .addHelpText("after", "\n### Overview\nRestore a previously soft-deleted calendar event, making it active and visible in default list queries.\n\n### When to Use\nRecover an event that was accidentally soft-deleted.\n\n### Constraints\n- **Optimistic Locking**: Supports optional optimistic locking via `expected_version` in the request body.\n- **Side Effects**: When restoring an event with attendees, all participants will asynchronously receive a new invitation email containing an `.ics` REQUEST attachment via Cloudflare `waitUntil`.\n- **State Integrity**: You cannot restore a live (non-deleted) event. Restoring a live event is treated as an error.\n\n### Troubleshooting\n- Returns 404 `NOT_FOUND` if the event does not exist, or is NOT currently soft-deleted.\n- Returns 409 `VERSION_CONFLICT` if `expected_version` does not match the database value.\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail with 409 `VERSION_CONFLICT` if someone else has mutated the event since you last read.", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await eventRestore({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_restore", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

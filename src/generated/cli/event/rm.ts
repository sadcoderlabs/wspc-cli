// AUTO-GENERATED — DO NOT EDIT (source: event_delete)
import { Command } from "commander"
import { eventDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const eventDeleteCommand = new Command("rm")
  .description("Soft-delete a calendar event")
  .addHelpText("after", "\n### Overview\nSoft-delete an existing calendar event, hiding it from default listings.\n\n### When to Use\nRemove an event entirely from the user's historical view and calendar client. If the meeting was cancelled but should remain in history (notifying participants of cancellation), use `PATCH /calendar/events/{id}` with `status: cancelled` instead.\n\n### Constraints\n- **Optimistic Locking**: Supports optional optimistic locking via `expected_version` in the request body.\n- **Side Effects**: When soft-deleting an event with attendees, all participants will asynchronously receive a cancellation email containing an `.ics` CANCEL attachment via Cloudflare `waitUntil`.\n- **Recovery**: The record is preserved in the database as a soft-deleted row and can be brought back using `POST /calendar/events/{id}/restore`.\n\n### Troubleshooting\n- Returns 404 `NOT_FOUND` if the event does not exist, or has already been soft-deleted.\n- Returns 409 `VERSION_CONFLICT` if `expected_version` does not match the database value.\n\nExamples:\n  $ wspc event rm evt_xxx\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail with 409 `VERSION_CONFLICT` if someone else has mutated the event since you last read.", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: eventDelete,
      input: {
        path: {
          id,
        },
        body: {
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "event_delete", display: {"shape":"object","format":{"id":"id-short","deleted_at":"relative-time"}} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: event_get)
import { Command } from "commander"
import { eventGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const eventGetCommand = new Command("show")
  .description("Get a calendar event by id")
  .addHelpText("after", "\n### Overview\nFetch a single calendar event by its unique ID, returning the complete record including all attendees.\n\n### When to Use\nDisplay a detailed view of an event, or read the latest database state (capturing `version`) prior to executing an optimistic-locked PATCH update.\n\n### Constraints\n- **Deleted Events**: Soft-deleted events return 404 `NOT_FOUND` by default. You must explicitly pass `include_deleted=true` in the query parameters to retrieve a soft-deleted row.\n- **ICS Format**: To download the RFC 5545 iCalendar text representation of this event, use `GET /calendar/events/{id}.ics` instead.\n\n### Troubleshooting\n- Returns 404 `NOT_FOUND` if the event does not exist, is soft-deleted (without `include_deleted=true`), or is owned by another user.\n\nExamples:\n  $ wspc event show evt_xxx\n")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "When `true`, return the row even if soft-deleted. Default `false` (returns 404).")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: eventGet,
      input: {
        path: {
          id,
        },
        query: {
          include_deleted: opts.includeDeleted,
        },
      },
      context: { kind: "event_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

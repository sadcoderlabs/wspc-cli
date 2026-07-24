// AUTO-GENERATED — DO NOT EDIT (source: event_ics_download)
import { Command } from "commander"
import { eventIcsDownload } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const eventIcsDownloadCommand = new Command("ics")
  .description("Download event as `.ics`")
  .addHelpText("after", "\n### Overview\nReturn a single event rendered as an RFC 5545 `.ics` file suitable for import into major calendar clients.\n\n### When to Use\nExpose a 'Save to my calendar' link in email notifications, show a download button in a UI, or programmatically forward raw iCalendar text to third parties.\n\n### Constraints\n- **Router Match**: The path parameter `filename` must be exactly `<event_id>.ics`. The `.ics` suffix is strictly required for the router to match this endpoint ahead of the JSON detail endpoint.\n- **Response Payload**: The response is plain text containing the iCalendar specification, NOT JSON. The `Content-Type` is set to `text/calendar; charset=utf-8` with `Content-Disposition: inline; filename=\"<event_id>.ics\"`.\n- **Authentication**: Standard authentication is required (Bearer API key or OAuth access token), as this endpoint is secure.\n\n### Troubleshooting\n- Returns 404 `NOT_FOUND` if the event does not exist, is soft-deleted, or is owned by another user.\n\nExamples:\n  $ wspc event ics evt_xxx > event.ics\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: eventIcsDownload,
      input: {
        path: {
          filename: `${id}.ics`,
        },
      },
      context: { kind: "event_ics_download", display: {"shape":"raw"} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: event_occurrence_restore)
import { Command } from "commander"
import { eventOccurrenceRestore } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const eventOccurrenceRestoreCommand = new Command("restore")
  .description("Restore one recurring occurrence")
  .addHelpText("after", "\nDelete the target Occurrence Exception. An effective restore sends a newer-revision instance `REQUEST`, and the target Occurrence inherits the Series Master again. The instance message uses the Series `UID` and target `RECURRENCE-ID`, and it affects only the target Occurrence. Other Occurrences do not change. Email is sent only to the Series Master's current attendees. No email is sent when there are no attendees or the mutation is an idempotent no-op. An idempotent no-op does not create a new notification revision. Failed mutations do not schedule email. Email is scheduled asynchronously through Cloudflare `waitUntil()`. A 2xx response does not mean provider delivery completed. Provider delivery failure does not roll back the Calendar mutation or change its response.\n")
  .argument("<series_id>", "series_id")
  .argument("<recurrence_id>", "recurrence_id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (series_id, recurrence_id, opts) => {
    await runSdkCommand({
      operation: eventOccurrenceRestore,
      input: {
        path: {
          series_id,
          recurrence_id,
        },
        body: {
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "event_occurrence_restore", display: {"shape":"list","columns":["recurrence_id","start","end","status","exception_version","time_zone"],"format":{"recurrence_id":"truncate","start":"relative-time","end":"relative-time","status":"status-badge"},"emptyMessage":"no occurrences"} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: event_occurrence_cancel)
import { Command } from "commander"
import { eventOccurrenceCancel } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const eventOccurrenceCancelCommand = new Command("cancel")
  .description("Cancel one recurring occurrence")
  .addHelpText("after", "\nPersist an Occurrence Exception for the target Recurrence ID. An effective cancellation sends an instance `CANCEL` and does not cancel the whole Recurring Series. The instance message uses the Series `UID` and target `RECURRENCE-ID`, and it affects only the target Occurrence. Other Occurrences do not change. Email is sent only to the Series Master's current attendees. No email is sent when there are no attendees or the mutation is an idempotent no-op. An idempotent no-op does not create a new notification revision. Failed mutations do not schedule email. Email is scheduled asynchronously through Cloudflare `waitUntil()`. A 2xx response does not mean provider delivery completed. Provider delivery failure does not roll back the Calendar mutation or change its response.\n")
  .argument("<series_id>", "series_id")
  .argument("<recurrence_id>", "recurrence_id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (series_id, recurrence_id, opts) => {
    await runSdkCommand({
      operation: eventOccurrenceCancel,
      input: {
        path: {
          series_id,
          recurrence_id,
        },
        body: {
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "event_occurrence_cancel", display: {"shape":"list","columns":["recurrence_id","start","end","status","exception_version","time_zone"],"format":{"recurrence_id":"truncate","start":"relative-time","end":"relative-time","status":"status-badge"},"emptyMessage":"no occurrences"} },
    })
  })

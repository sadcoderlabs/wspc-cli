// AUTO-GENERATED — DO NOT EDIT (source: event_occurrence_cancel)
import { Command } from "commander"
import { eventOccurrenceCancel } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const eventOccurrenceCancelCommand = new Command("cancel")
  .description("Cancel one recurring occurrence")
  .addHelpText("after", "\nPersist a cancellation exception for one recurrence identity without cancelling the whole series.\n")
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

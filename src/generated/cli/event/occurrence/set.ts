// AUTO-GENERATED — DO NOT EDIT (source: event_occurrence_set)
import { Command } from "commander"
import { eventOccurrenceSet, eventGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseOccurrenceMutationTimes } from "../../../../handwritten/utils/parse-time.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const eventOccurrenceSetCommand = new Command("set")
  .description("Reschedule one recurring occurrence")
  .addHelpText("after", "\nReplace the complete effective start and end of one immutable recurrence identity. The series recurrence rule and time zone remain unchanged.\n")
  .argument("<series_id>", "series_id")
  .argument("<recurrence_id>", "recurrence_id")
  .requiredOption("--start <value>", "start")
  .requiredOption("--end <value>", "end")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--tz <value>", "tz")
  .action(async (series_id, recurrence_id, opts) => {
    const masterResult = await runSdkCommand({
      operation: eventGet,
      input: { path: { id: series_id } },
      context: { kind: "event_get", display: undefined },
      renderResult: false,
    })
    if (masterResult === undefined) return
    const { start: startValue, end: endValue } = parseOccurrenceMutationTimes(
      masterResult,
      opts.start as string,
      opts.end as string,
      opts.tz as string | undefined,
    )
    await runSdkCommand({
      operation: eventOccurrenceSet,
      input: {
        path: {
          series_id,
          recurrence_id,
        },
        body: {
          start: startValue as string,
          end: endValue as string,
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "event_occurrence_set", display: {"shape":"list","columns":["recurrence_id","start","end","status","exception_version","time_zone"],"format":{"recurrence_id":"truncate","start":"relative-time","end":"relative-time","status":"status-badge"},"emptyMessage":"no occurrences"} },
    })
  })

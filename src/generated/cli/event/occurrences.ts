// AUTO-GENERATED — DO NOT EDIT (source: event_occurrences)
import { Command } from "commander"
import { eventOccurrences } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { resolveTimezone, parseOccurrenceBoundary } from "../../../handwritten/utils/parse-time.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const eventOccurrencesCommand = new Command("occurrences")
  .description("List occurrences of one recurring series")
  .addHelpText("after", "\nExpand one recurring series in the required bounded start-based half-open window `[start, end)`. This read does not materialize occurrence rows or change the series master.\n\nExamples:\n  $ wspc event occurrences evt_xxx --from \"this Monday\" --to \"next Monday\"\n")
  .argument("<id>", "id")
  .requiredOption("--from <value>", "from")
  .requiredOption("--to <value>", "to")
  .option("--limit <value>", "limit", (value: string) => parseIntegerField(value, "limit"))
  .option("--cursor <value>", "cursor")
  .option("--include-cancelled", "include_cancelled")
  .option("--tz <zone>", "IANA timezone for relative time parsing")
  .action(async (id, opts) => {
    const zone = resolveTimezone(opts.tz as string | undefined)
    const fromValue = parseOccurrenceBoundary(opts.from as string, zone)
    const toValue = parseOccurrenceBoundary(opts.to as string, zone)
    await runSdkCommand({
      operation: eventOccurrences,
      input: {
        path: {
          id,
        },
        query: {
          start: fromValue,
          end: toValue,
          limit: opts.limit,
          cursor: opts.cursor,
          include_cancelled: opts.includeCancelled,
        },
      },
      context: { kind: "event_occurrences", display: {"shape":"list","columns":["recurrence_id","start","end","status","exception_version","time_zone"],"format":{"recurrence_id":"truncate","start":"relative-time","end":"relative-time","status":"status-badge"},"emptyMessage":"no occurrences"} },
    })
  })

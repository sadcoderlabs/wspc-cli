// AUTO-GENERATED — DO NOT EDIT (source: event_agenda)
import { Command } from "commander"
import { eventAgenda } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { resolveTimezone, parseAgendaBoundary } from "../../../handwritten/utils/parse-time.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const eventAgendaCommand = new Command("agenda")
  .description("List a bounded calendar agenda")
  .addHelpText("after", "\nMerge overlapping single events and recurring occurrences in a required bounded instant window. The view time zone controls all-day overlap and ordering; event lists remain master-only.\n\nExamples:\n  $ wspc event agenda --from \"this Monday\" --to \"next Monday\"\n")
  .requiredOption("--from <value>", "Offset-bearing ISO 8601 date-time boundary for the half-open agenda window.")
  .requiredOption("--to <value>", "Offset-bearing ISO 8601 date-time boundary for the half-open agenda window.")
  .option("--tz <value>", "UTC or a supported IANA time zone. Aliases are accepted and the response returns the canonical zone.")
  .option("--include-cancelled", "Include cancelled single events and whole-series occurrences. Default false.")
  .option("--limit <value>", "Maximum agenda items on this page. Default 100; range 1 to 200.", (value: string) => parseIntegerField(value, "limit"))
  .option("--cursor <value>", "Opaque agenda pagination cursor.")
  .action(async (opts) => {
    const zone = resolveTimezone(opts.tz as string | undefined)
    const fromValue = parseAgendaBoundary(opts.from as string, zone)
    const toValue = parseAgendaBoundary(opts.to as string, zone)
    await runSdkCommand({
      operation: eventAgenda,
      input: {
        query: {
          start: fromValue,
          end: toValue,
          view_time_zone: zone,
          include_cancelled: opts.includeCancelled,
          limit: opts.limit,
          cursor: opts.cursor,
        },
      },
      context: { kind: "event_agenda", display: {"shape":"list","columns":["kind","start","end","title","status","event_id","series_id","recurrence_id","time_zone"],"format":{"start":"relative-time","end":"relative-time","title":"truncate","status":"status-badge","event_id":"id-short","series_id":"id-short","recurrence_id":"truncate"},"emptyMessage":"no agenda items"} },
    })
  })

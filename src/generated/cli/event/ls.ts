// AUTO-GENERATED — DO NOT EDIT (source: event_list)
import { Command } from "commander"
import { eventList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"

export const eventListCommand = new Command("ls")
  .description("List calendar events")
  .option("--q <value>", "Optional full-text search across title, description, and location (case-insensitive substring).")
  .option("--from <value>", "Inclusive lower bound on the event `start` (ISO datetime with offset, or ISO date-only). When ANY of `start_from`/`start_to`/`end_from`/`end_to` is provided, the implicit past filter is disabled.")
  .option("--to <value>", "Inclusive upper bound on the event `start`.")
  .option("--end-from <value>", "Inclusive lower bound on the event `end`.")
  .option("--end-to <value>", "Inclusive upper bound on the event `end`.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .option("--limit <value>", "Maximum number of events to return. Clamped to `[1, 200]`. Default is server-defined.")
  .option("--include-deleted <value>", "When `true`, include soft-deleted events. Default `false`.")
  .option("--include-past <value>", "When omitted or `false`, events whose `end` is before now are hidden. Pass `true` to include them. Ignored when any of `start_from`/`start_to`/`end_from`/`end_to` is provided — explicit time bounds always win.")
  .option("--tz <zone>", "IANA timezone for relative time parsing")
  .action(async (opts) => {
    const zone = resolveTimezone(opts.tz as string | undefined)
    let fromValue: string | undefined
    if (opts.from !== undefined) {
      fromValue = parseTimeInput(opts.from as string, zone).toISO() ?? undefined
    }
    let toValue: string | undefined
    if (opts.to !== undefined) {
      toValue = parseTimeInput(opts.to as string, zone).toISO() ?? undefined
    }
    await runSdkCommand({ kind: "event_list", display: {"shape":"list","columns":["id","status","title","start","end"],"format":{"id":"id-short","status":"status-badge","title":"truncate","start":"relative-time","end":"relative-time"},"emptyMessage":"no events"} }, (client) => eventList({
      client,
      query: {
        q: opts.q,
        start_from: fromValue,
        start_to: toValue,
        end_from: opts.endFrom,
        end_to: opts.endTo,
        cursor: opts.cursor,
        limit: opts.limit,
        include_deleted: opts.includeDeleted,
        include_past: opts.includePast,
      },
    }))
  })

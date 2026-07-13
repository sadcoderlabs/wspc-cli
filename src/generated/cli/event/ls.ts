// AUTO-GENERATED — DO NOT EDIT (source: event_list)
import { Command } from "commander"
import { eventList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"

export const eventListCommand = new Command("ls")
  .description("List calendar events")
  .addHelpText("after", "\n### Overview\nReturn the authenticated user's events, ordered by `start` ascending, with cursor pagination.\n\n### When to Use\nRender calendar list/grid views, search for specific terms using full-text search, query events within a specific time window, or retrieve historically past events.\n\n### Constraints\n- **Default Visibility**: By default, soft-deleted events and past events (events where `end` is before the current time) are automatically hidden.\n- **Time Bounds Override**: Supplying any explicit time bound query parameter (`start_from`, `start_to`, `end_from`, `end_to`) or passing `include_past=true` overrides and disables the implicit past filter.\n- **Search Scope**: `q` performs a case-insensitive substring search across `title`, `description`, and `location`.\n- **Pagination**: The `limit` query parameter is clamped to `[1, 200]`; cursor pagination is enabled via the opaque `cursor` parameter.\n\n### Troubleshooting\n- Returns 400 `VALIDATION_ERROR` if date query bounds are invalid (e.g. `start_from > start_to` or `end_from > end_to`).\n\nExamples:\n  $ wspc event ls\n  $ wspc event ls --from \"today\" --to \"next week\"\n")
  .option("--q <value>", "Optional full-text search across title, description, and location (case-insensitive substring).")
  .option("--from <value>", "Inclusive lower bound on the event `start` (ISO datetime with offset, or ISO date-only). When ANY of `start_from`/`start_to`/`end_from`/`end_to` is provided, the implicit past filter is disabled.")
  .option("--to <value>", "Inclusive upper bound on the event `start`.")
  .option("--end-from <value>", "Inclusive lower bound on the event `end`.")
  .option("--end-to <value>", "Inclusive upper bound on the event `end`.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .option("--limit <value>", "Maximum number of events to return. Clamped to `[1, 200]`. Default is server-defined.")
  .option("--include-deleted", "include_deleted")
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
    const client = await loadSdkClient()
    const result = await eventList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
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
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_list", display: {"shape":"list","columns":["id","status","title","start","end"],"format":{"id":"id-short","status":"status-badge","title":"truncate","start":"relative-time","end":"relative-time"},"emptyMessage":"no events"} }, result.data)
  })

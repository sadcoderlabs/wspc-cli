// AUTO-GENERATED — DO NOT EDIT (source: event_list)
import { Command } from "commander"
import { eventList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"

export const eventListCommand = new Command("ls")
  .description("List calendar events")
  .addHelpText("after", "\n### Overview\nReturn the authenticated user's events, ordered by `start` ascending, with cursor pagination.\n\n### When to Use\nRender calendar list/grid views, search for specific terms using full-text search, query events within a specific time window, or retrieve historically past events.\n\n### Constraints\n- **Default Visibility**: By default, soft-deleted events and past events (events where `end` is before the current time) are automatically hidden.\n- **Time Bounds Override**: Supplying any explicit time bound query parameter (`start_from`, `start_to`, `end_from`, `end_to`) or passing `include_past=true` overrides and disables the implicit past filter.\n- **Calendar Trash**: `deleted_only=true` returns only soft-deleted events for the current user and Workspace. It overrides `include_deleted` and disables the implicit past filter regardless of `include_past`. Explicit time bounds and `q` still apply. Series Masters remain single rows; cancelled occurrences are not Trash.\n- **Search Scope**: `q` performs a case-insensitive substring search across `title`, `description`, and `location`.\n- **Pagination**: Default `limit` is 50, clamped to `[1, 200]`. Matching events are ordered by `start ASC, id ASC` before cursor pagination. Cursor is a page position, not a Consistency bookmark or snapshot.\n\n### Troubleshooting\n- Returns 400 `VALIDATION_ERROR` if date query bounds are invalid (e.g. `start_from > start_to` or `end_from > end_to`).\n\nExamples:\n  $ wspc event ls\n  $ wspc event ls --deleted-only\n  $ wspc event ls --from \"today\" --to \"next week\"\n")
  .option("--q <value>", "Optional full-text search across title, description, and location (case-insensitive substring).")
  .option("--from <value>", "Inclusive lower bound on the event `start` (ISO datetime with offset, or ISO date-only). When ANY of `start_from`/`start_to`/`end_from`/`end_to` is provided, the implicit past filter is disabled.")
  .option("--to <value>", "Inclusive upper bound on the event `start`.")
  .option("--end-from <value>", "Inclusive lower bound on the event `end`.")
  .option("--end-to <value>", "Inclusive upper bound on the event `end`.")
  .option("--cursor <value>", "Opaque pagination cursor returned in `next_cursor` of a previous response.")
  .option("--limit <value>", "Maximum number of events to return. Clamped to `[1, 200]`. Default is 50.")
  .option("--deleted-only", "deleted_only")
  .option("--include-deleted", "include_deleted")
  .option("--include-past <value>", "When omitted or `false`, events whose `end` is before now are hidden. Pass `true` to include them. Ignored when `deleted_only=true` or any of `start_from`/`start_to`/`end_from`/`end_to` is provided — explicit time bounds always win.")
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
    await runSdkCommand({
      operation: eventList,
      input: {
        query: {
          q: opts.q,
          start_from: fromValue,
          start_to: toValue,
          end_from: opts.endFrom,
          end_to: opts.endTo,
          cursor: opts.cursor,
          limit: opts.limit,
          deleted_only: opts.deletedOnly,
          include_deleted: opts.includeDeleted,
          include_past: opts.includePast,
        },
      },
      context: { kind: "event_list", display: {"shape":"list","columns":["id","status","title","start","end"],"format":{"id":"id-short","status":"status-badge","title":"truncate","start":"relative-time","end":"relative-time"},"emptyMessage":"no events"} },
    })
  })

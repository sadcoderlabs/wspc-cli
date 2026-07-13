// AUTO-GENERATED — DO NOT EDIT (source: event_create)
import { Command } from "commander"
import { eventCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"
import { parseDateOnly, inclusiveEndToExclusive } from "../../../handwritten/utils/parse-date.js"
import { parseAttendee } from "../../../handwritten/utils/parse-attendee.js"

export const eventCreateCommand = new Command("add")
  .description("Schedule a calendar event")
  .addHelpText("after", "\n### Overview\nCreate a new calendar event owned by the authenticated user.\n\n### When to Use\nBook a meeting, lunch, all-day trip, or any time-bound item. Optionally provide `attendees` to automatically dispatch invitation emails containing an `.ics` REQUEST attachment to each participant as a side effect.\n\n### Constraints\n- **Format Integrity**: `start` and `end` must be of the exact same type (both ISO 8601 datetimes with offset, or both ISO date-only for all-day).\n- **Chronological Order**: `end` must be strictly after `start`.\n- **All-Day boundary**: All-day events use RFC 5545 exclusive end (e.g., a one-day event on June 1st is specified as `start=2026-06-01` and `end=2026-06-02`).\n- **Attendee Limit**: Up to 50 unique attendees are supported after case-insensitive email address deduplication.\n\n### Troubleshooting\n- Returns 400 `VALIDATION_ERROR` if `start` and `end` format mismatch, or if `end <= start`.\n- Returns 400 `ATTENDEE_LIMIT_EXCEEDED` if more than 50 unique attendees are supplied.\n- Invitation emails are processed and dispatched asynchronously via Cloudflare `waitUntil`; the analytics counter `event_created` is emitted automatically.\n\nExamples:\n  $ wspc event add \"Lunch with Alice\" --start \"tomorrow 12:30pm\" --end \"tomorrow 1:30pm\"\n  $ wspc event add \"Team offsite\" --all-day --start 2026-06-01 --end 2026-06-01\n")
  .argument("<title>", "title")
  .option("--description <value>", "Free-form notes about the event (agenda, dial-in instructions, etc.). Markdown formatted (CommonMark + GFM tables, strikethrough, task lists); stored verbatim. Invitation emails include the raw source — most email clients display it as plain text.")
  .option("--start <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("--end <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("-l, --location <value>", "Free-text location — physical address, room, or short note. Separate from `url` (meeting link).")
  .option("-u, --url <value>", "Optional meeting link (Zoom / Meet / etc.). Kept separate from `location` so calendar clients can render it as a join action.")
  .option("--status <value>", "Lifecycle status. `confirmed`: the event will happen (default). `tentative`: organizer has not finalized; still visible in lists. `cancelled`: the event was called off but the record is kept so attendees can be notified and history audited; distinct from soft-delete (DELETE `/calendar/events/{id}`) which hides the event from default list responses.")
  .option("--attendee <value>", "Up to 50 unique attendees (deduped case-insensitively by email). If non-empty, each attendee receives an invitation email with an `.ics` REQUEST attachment as a side effect of creation.", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])
  .option("--idempotency-key <value>", "idempotency_key")
  .option("--all-day", "all_day")
  .option("--tz <zone>", "IANA timezone for relative time parsing")
  .action(async (title, opts) => {
    const zone = resolveTimezone(opts.tz as string | undefined)
    let startValue: string | undefined
    if (opts.start !== undefined) {
      if (opts.allDay) {
        startValue = parseDateOnly(opts.start as string)
      } else {
        startValue = parseTimeInput(opts.start as string, zone).toISO() ?? undefined
      }
    }
    let endValue: string | undefined
    if (opts.end !== undefined) {
      if (opts.allDay) {
        endValue = inclusiveEndToExclusive(opts.end as string)
      } else {
        endValue = parseTimeInput(opts.end as string, zone).toISO() ?? undefined
      }
    }
    const attendeeRaw = opts.attendee as string[]
    const attendees = attendeeRaw.length > 0 ? attendeeRaw.map(parseAttendee) : undefined
    const client = await loadSdkClient()
    const result = await eventCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        title,
        description: opts.description,
        start: startValue as string,
        end: endValue as string,
        location: opts.location,
        url: opts.url,
        status: opts.status,
        attendees: attendees,
        idempotency_key: opts.idempotencyKey,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

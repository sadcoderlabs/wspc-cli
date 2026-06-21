// AUTO-GENERATED — DO NOT EDIT (source: event_create)
import { Command } from "commander"
import { eventCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"
import { parseDateOnly, inclusiveEndToExclusive } from "../../../handwritten/utils/parse-date.js"
import { parseAttendee } from "../../../handwritten/utils/parse-attendee.js"

export const eventCreateCommand = new Command("add")
  .description("Schedule a calendar event")
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
    await runSdkCommand({ kind: "event_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => eventCreate({
      client,
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
    }))
  })

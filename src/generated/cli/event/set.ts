// AUTO-GENERATED — DO NOT EDIT (source: event_update)
import { Command } from "commander"
import { eventUpdate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"
import { parseDateOnly, inclusiveEndToExclusive } from "../../../handwritten/utils/parse-date.js"
import { parseAttendee } from "../../../handwritten/utils/parse-attendee.js"

export const eventUpdateCommand = new Command("set")
  .description("Update a calendar event")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail the call if someone else has mutated the event since you last read. On mismatch the server returns 409 `VERSION_CONFLICT` and includes the current and sent versions in the message.")
  .option("--title <value>", "New event title. Omit to leave unchanged.")
  .option("--description <value>", "New description. Markdown formatted (CommonMark + GFM tables, strikethrough, task lists). Pass an empty string to clear; omit to leave unchanged.")
  .option("--start <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("--end <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("-l, --location <value>", "New location. Pass an empty string to clear; omit to leave unchanged.")
  .option("-u, --url <value>", "New meeting link. Pass an empty string to clear; omit to leave unchanged.")
  .option("--status <value>", "Lifecycle status. `confirmed`: the event will happen (default). `tentative`: organizer has not finalized; still visible in lists. `cancelled`: the event was called off but the record is kept so attendees can be notified and history audited; distinct from soft-delete (DELETE `/calendar/events/{id}`) which hides the event from default list responses.")
  .option("--attendee <value>", "If provided, REPLACES the attendee list (after case-insensitive email dedupe, up to 50). Added attendees receive a fresh invitation, kept attendees receive an update email, removed attendees receive a cancellation.", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])
  .option("--all-day", "all_day")
  .option("--tz <zone>", "IANA timezone for relative time parsing")
  .action(async (id, opts) => {
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
    await runSdkCommand({ kind: "event_update", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => eventUpdate({
      client,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        title: opts.title,
        description: opts.description,
        start: startValue,
        end: endValue,
        location: opts.location,
        url: opts.url,
        status: opts.status,
        attendees: attendees,
      },
    }))
  })

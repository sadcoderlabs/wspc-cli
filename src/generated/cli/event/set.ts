// AUTO-GENERATED — DO NOT EDIT (source: event_update)
import { Command } from "commander"
import { eventUpdate, eventGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"
import { parseDateOnly } from "../../../handwritten/utils/parse-date.js"
import { parseAttendee } from "../../../handwritten/utils/parse-attendee.js"
import { parseIntegerField } from "../../../handwritten/utils/parse-scalar-field.js"

export const eventUpdateCommand = new Command("set")
  .description("Update a calendar event")
  .addHelpText("after", "\n### Overview\nPartially update fields of an existing calendar event. All properties in the request body are optional.\n\n### When to Use\nReschedule an event, update its location or notes, cancel the meeting (retaining the record but notifying participants), or replace/update the attendee list.\n\n### Constraints\n- **Optimistic Locking**: Pass `expected_version` to fail with `VERSION_CONFLICT` if another mutation occurred concurrently since you last read. Omit to let the server force the update.\n- **Field Clearing**: Pass an empty string `\"\"` for `description`, `location`, `url`, `recurrence_rule`, or `time_zone` to clear that field. Clearing recurrence also clears its zone; clearing only the zone preserves the instants and returns the series to UTC semantics.\n- **Recurring Series**: A recurrence rule is an RFC 5545 RRULE value without the `RRULE:` prefix. Local timed series provide canonicalizable `time_zone` and matching offset-bearing start/end. Update, cancel, delete, and restore always affect the whole series master.\n- **Attendee replacement**: Providing the `attendees` property fully REPLACES the existing participant list. The server automatically diffs participants and asynchronously sends invitations (for newly added), updates (for kept), or cancellations (for removed) via Cloudflare `waitUntil`.\n- **Validation Rules**: Mismatched start/end formats or chronological order violations will fail the request.\n- **Attendee Limit**: A maximum of 50 unique attendees is allowed.\n\n### Troubleshooting\n- Returns 404 `NOT_FOUND` if the event does not exist or is soft-deleted.\n- Returns 409 `VERSION_CONFLICT` if `expected_version` is provided but stale.\n- Returns 400 `VALIDATION_ERROR` if `start` and `end` kinds do not match, or if `end <= start`.\n- Returns 400 `ATTENDEE_LIMIT_EXCEEDED` if unique attendees exceed 50.\n\nExamples:\n  $ wspc event set evt_xxx --start \"tomorrow 1pm\" --end \"tomorrow 2pm\"\n  $ wspc event set evt_xxx --all-day --start 2026-06-01 --end 2026-06-02\n  $ wspc event set evt_xxx --status cancelled\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail the call if someone else has mutated the event since you last read. On mismatch the server returns 409 `VERSION_CONFLICT` and includes the current and sent versions in the message.", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--title <value>", "New event title. Omit to leave unchanged.")
  .option("--description <value>", "New description. Markdown formatted (CommonMark + GFM tables, strikethrough, task lists). Pass an empty string to clear; omit to leave unchanged.")
  .option("--start <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("--end <value>", "Accepts ISO 8601 datetime with offset (e.g. `2026-06-01T12:30:00+08:00`) for timed events, or ISO date-only (e.g. `2026-06-01`) for all-day. The `wspc` CLI additionally accepts natural-language phrases (`tomorrow 12:30pm`, `next Monday 9am`) and resolves them to ISO before sending; the server itself only accepts ISO. All-day uses RFC 5545 exclusive end: a one-day event on 6/1 is `start=2026-06-01, end=2026-06-02`; both endpoints must be the same type.")
  .option("-l, --location <value>", "New location. Pass an empty string to clear; omit to leave unchanged.")
  .option("-u, --url <value>", "New meeting link. Pass an empty string to clear; omit to leave unchanged.")
  .option("--status <value>", "Lifecycle status. `confirmed`: the event will happen (default). `tentative`: organizer has not finalized; still visible in lists. `cancelled`: the event was called off but the record is kept so attendees can be notified and history audited; distinct from soft-delete (DELETE `/calendar/events/{id}`) which hides the event from default list responses.")
  .option("--attendee <value>", "If provided, REPLACES the attendee list (after case-insensitive email dedupe, up to 50). Added attendees receive a fresh invitation, kept attendees receive an update email, removed attendees receive a cancellation.", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])
  .option("--rrule <value>", "rrule")
  .option("--tz <value>", "Optional recurring-series time zone. Use `UTC` or a supported IANA identifier; aliases are canonicalized. Only timed recurring series may persist this field.")
  .option("--all-day", "all_day")
  .action(async (id, opts) => {
    let existingRecurringSeries = false
    if (opts.tz !== undefined && opts.tz !== "" && opts.rrule === undefined) {
      const existingEvent = await runSdkCommand({
        operation: eventGet,
        input: { path: { id } },
        context: { kind: "event_get", display: undefined },
        renderResult: false,
      })
      if (existingEvent === undefined) return
      existingRecurringSeries = existingEvent.recurrence_rule !== undefined
    }
    const recurringWithTimeZone = opts.rrule !== undefined ? opts.rrule !== "" : existingRecurringSeries
    const explicitSeriesTimeZone = opts.tz !== undefined && opts.tz !== "" && recurringWithTimeZone
    const seriesTimeZoneValue = opts.tz === "" ? "" : explicitSeriesTimeZone ? opts.tz : undefined
    const zone = resolveTimezone(opts.tz === "" ? undefined : (opts.tz as string | undefined))
    let startValue: string | undefined
    if (opts.start !== undefined) {
      if (opts.allDay) {
        startValue = parseDateOnly(opts.start as string)
      } else {
        const startDateTime = parseTimeInput(opts.start as string, zone)
        startValue = (opts.rrule !== undefined && !explicitSeriesTimeZone ? startDateTime.toUTC() : startDateTime).toISO() ?? undefined
      }
    }
    let endValue: string | undefined
    if (opts.end !== undefined) {
      if (opts.allDay) {
        endValue = parseDateOnly(opts.end as string)
      } else {
        const endDateTime = parseTimeInput(opts.end as string, zone)
        endValue = (opts.rrule !== undefined && !explicitSeriesTimeZone ? endDateTime.toUTC() : endDateTime).toISO() ?? undefined
      }
    }
    const attendeeRaw = opts.attendee as string[]
    const attendees = attendeeRaw.length > 0 ? attendeeRaw.map(parseAttendee) : undefined
    await runSdkCommand({
      operation: eventUpdate,
      input: {
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
          recurrence_rule: opts.rrule,
          time_zone: seriesTimeZoneValue,
        },
      },
      context: { kind: "event_update", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

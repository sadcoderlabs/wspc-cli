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
  .argument("<title>", "title")
  .option("--description <value>", "description")
  .option("--start <value>", "start")
  .option("--end <value>", "end")
  .option("-l, --location <value>", "location")
  .option("-u, --url <value>", "url")
  .option("--status <value>", "status")
  .option("--attendee <value>", "attendee", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])
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

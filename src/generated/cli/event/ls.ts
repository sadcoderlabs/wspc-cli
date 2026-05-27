// AUTO-GENERATED — DO NOT EDIT (source: event_list)
import { Command } from "commander"
import { eventList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"
import { parseTimeInput, resolveTimezone } from "../../../handwritten/utils/parse-time.js"

export const eventListCommand = new Command("ls")
  .description("List calendar events")
  .option("--q <value>", "q")
  .option("--from <value>", "from")
  .option("--to <value>", "to")
  .option("--end-from <value>", "end_from")
  .option("--end-to <value>", "end_to")
  .option("--cursor <value>", "cursor")
  .option("--limit <value>", "limit")
  .option("--include-deleted <value>", "include_deleted")
  .option("--include-past <value>", "include_past")
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

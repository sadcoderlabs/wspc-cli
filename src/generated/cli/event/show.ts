// AUTO-GENERATED — DO NOT EDIT (source: event_get)
import { Command } from "commander"
import { eventGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const eventGetCommand = new Command("show")
  .description("Get a calendar event by id")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "When `true`, return the row even if soft-deleted. Default `false` (returns 404).")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await eventGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

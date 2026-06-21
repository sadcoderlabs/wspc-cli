// AUTO-GENERATED — DO NOT EDIT (source: event_get)
import { Command } from "commander"
import { eventGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const eventGetCommand = new Command("show")
  .description("Get a calendar event by id")
  .argument("<id>", "id")
  .option("--include-deleted <value>", "When `true`, return the row even if soft-deleted. Default `false` (returns 404).")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "event_get", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","status":"status-badge","start":"relative-time","end":"relative-time","created_at":"relative-time","updated_at":"relative-time","deleted_at":"relative-time"}} }, (client) => eventGet({
      client,
      path: {
        id,
      },
      query: {
        include_deleted: opts.includeDeleted,
      },
    }))
  })

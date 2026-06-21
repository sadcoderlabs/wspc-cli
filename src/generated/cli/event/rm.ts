// AUTO-GENERATED — DO NOT EDIT (source: event_delete)
import { Command } from "commander"
import { eventDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const eventDeleteCommand = new Command("rm")
  .description("Soft-delete a calendar event")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail with 409 `VERSION_CONFLICT` if someone else has mutated the event since you last read.")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "event_delete", display: {"shape":"object","format":{"id":"id-short","deleted_at":"relative-time"}} }, (client) => eventDelete({
      client,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    }))
  })

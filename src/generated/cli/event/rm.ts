// AUTO-GENERATED — DO NOT EDIT (source: event_delete)
import { Command } from "commander"
import { eventDelete } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const eventDeleteCommand = new Command("rm")
  .description("Soft-delete a calendar event")
  .argument("<id>", "id")
  .option("--expected-version <value>", "Optional optimistic lock. Omit to let the server use the current version; pass only to fail with 409 `VERSION_CONFLICT` if someone else has mutated the event since you last read.")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await eventDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_delete", display: {"shape":"object","format":{"id":"id-short","deleted_at":"relative-time"}} }, result.data)
  })

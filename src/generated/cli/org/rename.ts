// AUTO-GENERATED — DO NOT EDIT (source: org_update)
import { Command } from "commander"
import { orgUpdate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const orgUpdateCommand = new Command("rename")
  .description("Update the authenticated user's organization")
  .option("--name <value>", "The new name for the organization. Cannot be empty or purely whitespace.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "org_update", display: {"shape":"object","fields":["id","name","created_at","updated_at"],"format":{"id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time"}} }, (client) => orgUpdate({
      client,
      body: {
        name: opts.name,
      },
    }))
  })

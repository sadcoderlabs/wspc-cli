// AUTO-GENERATED — DO NOT EDIT (source: org_get)
import { Command } from "commander"
import { orgGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const orgGetCommand = new Command("show")
  .description("Get the authenticated user's organization")
  .action(async (opts) => {
    await runSdkCommand({ kind: "org_get", display: {"shape":"object","fields":["id","name","created_at","updated_at"],"format":{"id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time"}} }, (client) => orgGet({
      client,
    }))
  })

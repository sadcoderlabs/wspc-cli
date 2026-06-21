// AUTO-GENERATED — DO NOT EDIT (source: email_alias_create)
import { Command } from "commander"
import { emailAliasCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailAliasCreateCommand = new Command("add")
  .description("Create a receiving alias")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    await runSdkCommand({ kind: "email_alias_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} }, (client) => emailAliasCreate({
      client,
      body: {
        email,
      },
    }))
  })

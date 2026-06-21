// AUTO-GENERATED — DO NOT EDIT (source: email_alias_delete)
import { Command } from "commander"
import { emailAliasDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailAliasDeleteCommand = new Command("rm")
  .description("Soft-delete an alias")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    await runSdkCommand({ kind: "email_alias_delete", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} }, (client) => emailAliasDelete({
      client,
      path: {
        email,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: invite_get)
import { Command } from "commander"
import { inviteGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const inviteGetCommand = new Command("show")
  .description("Get a single invite addressed to the caller")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "invite_get", display: undefined }, (client) => inviteGet({
      client,
      path: {
        id,
      },
    }))
  })

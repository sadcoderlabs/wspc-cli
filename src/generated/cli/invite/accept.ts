// AUTO-GENERATED — DO NOT EDIT (source: invite_accept)
import { Command } from "commander"
import { inviteAccept } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const inviteAcceptCommand = new Command("accept")
  .description("Accept an invite and switch into the inviting organization")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "invite_accept", display: {"shape":"object","fields":["id","name","created_at","updated_at"]} }, (client) => inviteAccept({
      client,
      path: {
        id,
      },
    }))
  })

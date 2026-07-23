// AUTO-GENERATED — DO NOT EDIT (source: invite_accept)
import { Command } from "commander"
import { inviteAccept } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const inviteAcceptCommand = new Command("accept")
  .description("Accept an invite and switch into the inviting organization")
  .addHelpText("after", "\nSwitches the caller's org to the invite's org and records the previous org. The caller loses access to data scoped to their previous org.\n\nExamples:\n  $ wspc invite accept inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: inviteAccept,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "invite_accept", display: {"shape":"object","fields":["id","name","created_at","updated_at"]} },
    })
  })

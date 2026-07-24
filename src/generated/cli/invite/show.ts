// AUTO-GENERATED — DO NOT EDIT (source: invite_get)
import { Command } from "commander"
import { inviteGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const inviteGetCommand = new Command("show")
  .description("Get a single invite addressed to the caller")
  .addHelpText("after", "\nRetrieves the metadata of a specific organization invite addressed to the caller by its ID.\n\nExamples:\n  $ wspc invite show inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: inviteGet,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "invite_get", display: undefined },
    })
  })

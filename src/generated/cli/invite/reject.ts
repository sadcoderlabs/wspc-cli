// AUTO-GENERATED — DO NOT EDIT (source: invite_reject)
import { Command } from "commander"
import { inviteReject } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const inviteRejectCommand = new Command("reject")
  .description("Reject an invite")
  .addHelpText("after", "\nRejects an organization invite addressed to the caller. The invite will be marked as rejected.\n\nExamples:\n  $ wspc invite reject inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: inviteReject,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "invite_reject", display: undefined },
    })
  })

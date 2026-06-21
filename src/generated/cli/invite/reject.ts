// AUTO-GENERATED — DO NOT EDIT (source: invite_reject)
import { Command } from "commander"
import { inviteReject } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const inviteRejectCommand = new Command("reject")
  .description("Reject an invite")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "invite_reject", display: undefined }, (client) => inviteReject({
      client,
      path: {
        id,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: org_invite_revoke)
import { Command } from "commander"
import { orgInviteRevoke } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const orgInviteRevokeCommand = new Command("revoke")
  .description("Revoke a pending invite")
  .addHelpText("after", "\nOwner or Admin workspace role required. Permanently revokes a pending organization invite. The invitee will no longer be able to accept it.\n\nExamples:\n  $ wspc org invite revoke inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: orgInviteRevoke,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "org_invite_revoke", display: undefined },
    })
  })

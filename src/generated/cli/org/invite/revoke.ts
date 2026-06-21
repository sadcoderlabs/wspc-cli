// AUTO-GENERATED — DO NOT EDIT (source: org_invite_revoke)
import { Command } from "commander"
import { orgInviteRevoke } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const orgInviteRevokeCommand = new Command("revoke")
  .description("Revoke a pending invite")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "org_invite_revoke", display: undefined }, (client) => orgInviteRevoke({
      client,
      path: {
        id,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: org_invite_revoke)
import { Command } from "commander"
import { orgInviteRevoke } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const orgInviteRevokeCommand = new Command("revoke")
  .description("Revoke a pending invite")
  .addHelpText("after", "\nPermanently revokes a pending organization invite. The invitee will no longer be able to accept it.\n\nExamples:\n  $ wspc org invite revoke inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await orgInviteRevoke({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_invite_revoke", display: undefined }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: org_invites_list)
import { Command } from "commander"
import { orgInvitesList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const orgInvitesListCommand = new Command("invites")
  .description("List invites issued by the caller's organization")
  .addHelpText("after", "\nOwner or Admin workspace role required. Retrieves a list of all active pending or expired organization invites issued by the caller's organization.\n")
  .action(async (opts) => {
    await runSdkCommand({
      operation: orgInvitesList,
      input: {
      },
      context: { kind: "org_invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} },
    })
  })

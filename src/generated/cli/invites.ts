// AUTO-GENERATED — DO NOT EDIT (source: invites_list)
import { Command } from "commander"
import { invitesList } from "../sdk/index.js"
import { runSdkCommand } from "../../handwritten/commands/run-sdk-command.js"

export const invitesListCommand = new Command("invites")
  .description("List invites addressed to the authenticated user's email")
  .addHelpText("after", "\nRetrieves all pending or expired organization invites addressed to the caller's verified email address.\n")
  .action(async (opts) => {
    await runSdkCommand({
      operation: invitesList,
      input: {
      },
      context: { kind: "invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","org_name","inviter_email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} },
    })
  })

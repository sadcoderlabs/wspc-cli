// AUTO-GENERATED — DO NOT EDIT (source: invites_list)
import { Command } from "commander"
import { invitesList } from "../sdk/index.js"
import { runSdkCommand } from "../../handwritten/commands/sdk-result.js"

export const invitesListCommand = new Command("invites")
  .description("List invites addressed to the authenticated user's email")
  .action(async (opts) => {
    await runSdkCommand({ kind: "invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","org_name","inviter_email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} }, (client) => invitesList({
      client,
    }))
  })

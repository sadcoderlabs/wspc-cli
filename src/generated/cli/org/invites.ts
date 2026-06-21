// AUTO-GENERATED — DO NOT EDIT (source: org_invites_list)
import { Command } from "commander"
import { orgInvitesList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const orgInvitesListCommand = new Command("invites")
  .description("List invites issued by the caller's organization")
  .action(async (opts) => {
    await runSdkCommand({ kind: "org_invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} }, (client) => orgInvitesList({
      client,
    }))
  })

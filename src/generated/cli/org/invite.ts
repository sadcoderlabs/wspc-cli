// AUTO-GENERATED — DO NOT EDIT (source: org_invite_create)
import { Command } from "commander"
import { orgInviteCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const orgInviteCreateCommand = new Command("invite")
  .description("Invite an email to join the caller's organization")
  .option("--email <value>", "Email address to invite into the caller's organization.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "org_invite_create", display: {"shape":"object","fields":["id","email","state","expires_at","invite_url"]} }, (client) => orgInviteCreate({
      client,
      body: {
        email: opts.email,
      },
    }))
  })

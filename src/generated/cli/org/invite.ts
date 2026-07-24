// AUTO-GENERATED — DO NOT EDIT (source: org_invite_create)
import { Command } from "commander"
import { orgInviteCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const orgInviteCreateCommand = new Command("invite")
  .description("Invite an email to join the caller's organization")
  .addHelpText("after", "\nCreates a pending invite for `email` and sends an invite email. Idempotent for an existing pending invite. The invitee accepts after signing in with the invited email.\n\nExamples:\n  $ wspc org invite bob@example.com\n")
  .option("--email <value>", "Email address to invite into the caller's organization.")
  .action(async (opts) => {
    await runSdkCommand({
      operation: orgInviteCreate,
      input: {
        body: {
          email: opts.email,
        },
      },
      context: { kind: "org_invite_create", display: {"shape":"object","fields":["id","email","state","expires_at","invite_url"]} },
    })
  })

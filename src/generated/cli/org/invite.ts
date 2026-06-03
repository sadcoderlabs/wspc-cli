// AUTO-GENERATED — DO NOT EDIT (source: org_invite_create)
import { Command } from "commander"
import { orgInviteCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const orgInviteCreateCommand = new Command("invite")
  .description("Invite an email to join the caller's organization")
  .option("--email <value>", "email")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await orgInviteCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        email: opts.email,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_invite_create", display: {"shape":"object","fields":["id","email","state","expires_at","invite_url"]} }, result.data)
  })

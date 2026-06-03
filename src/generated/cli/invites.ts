// AUTO-GENERATED — DO NOT EDIT (source: invites_list)
import { Command } from "commander"
import { invitesList } from "../sdk/index.js"
import { loadSdkClient } from "../../handwritten/auth/load-sdk-client.js"
import { render } from "../../handwritten/output/render.js"

export const invitesListCommand = new Command("invites")
  .description("List invites addressed to the authenticated user's email")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await invitesList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","org_name","inviter_email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: org_invites_list)
import { Command } from "commander"
import { orgInvitesList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const orgInvitesListCommand = new Command("invites")
  .description("List invites issued by the caller's organization")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await orgInvitesList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_invites_list", display: {"shape":"list","dataPath":"invites","columns":["id","email","state","expires_at"],"format":{"id":"id-short","expires_at":"relative-time"}} }, result.data)
  })

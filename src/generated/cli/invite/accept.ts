// AUTO-GENERATED — DO NOT EDIT (source: invite_accept)
import { Command } from "commander"
import { inviteAccept } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const inviteAcceptCommand = new Command("accept")
  .description("Accept an invite and switch into the inviting organization")
  .addHelpText("after", "\nSwitches the caller's org to the invite's org and records the previous org. The caller loses access to data scoped to their previous org.\n\nExamples:\n  $ wspc invite accept inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await inviteAccept({
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
    render({ kind: "invite_accept", display: {"shape":"object","fields":["id","name","created_at","updated_at"]} }, result.data)
  })

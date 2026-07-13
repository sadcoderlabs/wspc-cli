// AUTO-GENERATED — DO NOT EDIT (source: invite_get)
import { Command } from "commander"
import { inviteGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const inviteGetCommand = new Command("show")
  .description("Get a single invite addressed to the caller")
  .addHelpText("after", "\nRetrieves the metadata of a specific organization invite addressed to the caller by its ID.\n\nExamples:\n  $ wspc invite show inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await inviteGet({
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
    render({ kind: "invite_get", display: undefined }, result.data)
  })

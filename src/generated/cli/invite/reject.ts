// AUTO-GENERATED — DO NOT EDIT (source: invite_reject)
import { Command } from "commander"
import { inviteReject } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const inviteRejectCommand = new Command("reject")
  .description("Reject an invite")
  .addHelpText("after", "\nRejects an organization invite addressed to the caller. The invite will be marked as rejected.\n\nExamples:\n  $ wspc invite reject inv_...\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await inviteReject({
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
    render({ kind: "invite_reject", display: undefined }, result.data)
  })

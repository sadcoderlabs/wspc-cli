// AUTO-GENERATED — DO NOT EDIT (source: push_config_delete)
import { Command } from "commander"
import { pushConfigDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const pushConfigDeleteCommand = new Command("rm")
  .description("Remove a push transport")
  .argument("<transport>", "transport")
  .action(async (transport, opts) => {
    const client = await loadSdkClient()
    const result = await pushConfigDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        transport,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "push_config_delete", display: undefined }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: key_revoke)
import { Command } from "commander"
import { keyRevoke } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const keyRevokeCommand = new Command("rm")
  .description("Soft-revoke an API key")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await keyRevoke({
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
    render({ kind: "key_revoke", display: undefined }, result.data)
  })

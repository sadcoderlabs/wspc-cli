// AUTO-GENERATED — DO NOT EDIT (source: auth_me)
import { Command } from "commander"
import { authMe } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const authMeCommand = new Command("me")
  .description("Fetch the user identified by the bearer token")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await authMe({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "auth_me", display: {"shape":"object","fields":["user_id","email","display_name","api_key_id"],"format":{"user_id":"id-short","api_key_id":"id-short"}} }, result.data)
  })

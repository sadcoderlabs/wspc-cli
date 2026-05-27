// AUTO-GENERATED — DO NOT EDIT (source: email_alias_delete)
import { Command } from "commander"
import { emailAliasDelete } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailAliasDeleteCommand = new Command("rm")
  .description("Soft-delete an alias")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    const client = await loadSdkClient()
    const result = await emailAliasDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        email,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_alias_delete", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

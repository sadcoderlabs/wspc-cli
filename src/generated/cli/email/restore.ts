// AUTO-GENERATED — DO NOT EDIT (source: email_restore)
import { Command } from "commander"
import { emailRestore } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailRestoreCommand = new Command("restore")
  .description("Restore soft-deleted inbound emails")
  .addHelpText("after", "\n### Overview\nRestores a batch of soft-deleted inbound emails from the trash, making them reappear in standard inbox lists.\n\n### When to Use\n- Use this endpoint to recover email messages that were trashed by mistake.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Accepts 1 to 100 email IDs. Already-active IDs are silently ignored.\n\n### Troubleshooting\n- **401 Unauthorized**: Invalid token.\n- **400 Bad Request**: Malformed request or batch limit exceeded.\n")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    const client = await loadSdkClient()
    const result = await emailRestore({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        ids: ids as string[],
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_restore", display: {"shape":"object","format":{}} }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_mark_unread)
import { Command } from "commander"
import { emailMarkUnread } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailMarkUnreadCommand = new Command("unread")
  .description("Mark inbound emails as unread")
  .addHelpText("after", "\n### Overview\nResets a batch of inbound emails back to an unread state.\n\n### When to Use\n- Use this endpoint to undo an accidental read marking or to mark messages for later review.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Accepts 1 to 100 email IDs per call. Already-unread IDs are silently ignored but do not contribute to `marked`.\n\n### Troubleshooting\n- **401 Unauthorized**: Invalid Bearer token.\n- **400 Bad Request**: Malformed body or ID batch size limit exceeded.\n")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    const client = await loadSdkClient()
    const result = await emailMarkUnread({
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
    render({ kind: "email_mark_unread", display: {"shape":"object","format":{}} }, result.data)
  })

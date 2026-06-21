// AUTO-GENERATED — DO NOT EDIT (source: email_mark_unread)
import { Command } from "commander"
import { emailMarkUnread } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailMarkUnreadCommand = new Command("unread")
  .description("Mark inbound emails as unread")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({ kind: "email_mark_unread", display: {"shape":"object","format":{}} }, (client) => emailMarkUnread({
      client,
      body: {
        ids: ids as string[],
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_mark_read)
import { Command } from "commander"
import { emailMarkRead } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailMarkReadCommand = new Command("read")
  .description("Mark inbound emails as read")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({ kind: "email_mark_read", display: {"shape":"object","format":{}} }, (client) => emailMarkRead({
      client,
      body: {
        ids: ids as string[],
      },
    }))
  })

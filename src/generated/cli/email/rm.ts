// AUTO-GENERATED — DO NOT EDIT (source: email_delete)
import { Command } from "commander"
import { emailDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDeleteCommand = new Command("rm")
  .description("Soft-delete inbound emails")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({ kind: "email_delete", display: {"shape":"object","format":{}} }, (client) => emailDelete({
      client,
      body: {
        ids: ids as string[],
      },
    }))
  })

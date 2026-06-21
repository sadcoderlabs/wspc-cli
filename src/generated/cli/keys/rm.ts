// AUTO-GENERATED — DO NOT EDIT (source: key_revoke)
import { Command } from "commander"
import { keyRevoke } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const keyRevokeCommand = new Command("rm")
  .description("Soft-revoke an API key")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "key_revoke", display: undefined }, (client) => keyRevoke({
      client,
      path: {
        id,
      },
    }))
  })

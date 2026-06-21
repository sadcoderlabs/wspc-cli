// AUTO-GENERATED — DO NOT EDIT (source: push_config_delete)
import { Command } from "commander"
import { pushConfigDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const pushConfigDeleteCommand = new Command("rm")
  .description("Remove a push transport")
  .argument("<transport>", "transport")
  .action(async (transport, opts) => {
    await runSdkCommand({ kind: "push_config_delete", display: undefined }, (client) => pushConfigDelete({
      client,
      path: {
        transport,
      },
    }))
  })

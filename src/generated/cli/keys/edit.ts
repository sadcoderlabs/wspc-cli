// AUTO-GENERATED — DO NOT EDIT (source: key_update)
import { Command } from "commander"
import { keyUpdate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const keyUpdateCommand = new Command("edit")
  .description("Update an active API key's label")
  .argument("<id>", "id")
  .option("--label <value>", "Human-readable label for the key (1–60 chars after trimming).")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "key_update", display: undefined }, (client) => keyUpdate({
      client,
      path: {
        id,
      },
      body: {
        label: opts.label,
      },
    }))
  })

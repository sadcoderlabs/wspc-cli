// AUTO-GENERATED — DO NOT EDIT (source: key_create)
import { Command } from "commander"
import { keyCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const keyCreateCommand = new Command("create")
  .description("Create a new API key (full value returned once)")
  .option("--label <value>", "Human-readable label for the new key (1–60 chars after trimming). Pick something that identifies where the key will live — agent name, machine, or environment — so you can recognise it later in `wspc keys list`.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "key_create", display: {"shape":"object","fields":["id","label","api_key","created_at"],"format":{"id":"id-short","created_at":"relative-time"},"secretField":"api_key"} }, (client) => keyCreate({
      client,
      body: {
        label: opts.label,
      },
    }))
  })

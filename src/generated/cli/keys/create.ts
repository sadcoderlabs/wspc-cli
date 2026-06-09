// AUTO-GENERATED — DO NOT EDIT (source: key_create)
import { Command } from "commander"
import { keyCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const keyCreateCommand = new Command("create")
  .description("Create a new API key (full value returned once)")
  .option("--label <value>", "Human-readable label for the new key (1–60 chars after trimming). Pick something that identifies where the key will live — agent name, machine, or environment — so you can recognise it later in `wspc keys list`.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await keyCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        label: opts.label,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "key_create", display: {"shape":"object","fields":["id","label","api_key","created_at"],"format":{"id":"id-short","created_at":"relative-time"},"secretField":"api_key"} }, result.data)
  })

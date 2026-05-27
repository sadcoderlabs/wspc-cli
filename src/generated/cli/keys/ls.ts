// AUTO-GENERATED — DO NOT EDIT (source: key_list)
import { Command } from "commander"
import { keyList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const keyListCommand = new Command("ls")
  .description("List active API keys")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await keyList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "key_list", display: {"shape":"list","dataPath":"keys","columns":["id","label","last_4","created_at","last_used_at"],"format":{"id":"id-short","created_at":"relative-time","last_used_at":"relative-time"},"emptyMessage":"(no API keys)"} }, result.data)
  })

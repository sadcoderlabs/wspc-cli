// AUTO-GENERATED — DO NOT EDIT (source: key_list)
import { Command } from "commander"
import { keyList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const keyListCommand = new Command("ls")
  .description("List active API keys")
  .action(async (opts) => {
    await runSdkCommand({ kind: "key_list", display: {"shape":"list","dataPath":"keys","columns":["id","label","last_4","created_at","last_used_at"],"format":{"id":"id-short","created_at":"relative-time","last_used_at":"relative-time"},"emptyMessage":"(no API keys)"} }, (client) => keyList({
      client,
    }))
  })

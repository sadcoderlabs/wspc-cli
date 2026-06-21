// AUTO-GENERATED — DO NOT EDIT (source: push_config_get)
import { Command } from "commander"
import { pushConfigGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const pushConfigGetCommand = new Command("show")
  .description("List the caller's push transports")
  .action(async (opts) => {
    await runSdkCommand({ kind: "push_config_get", display: {"shape":"list","dataPath":"configs","columns":["transport","target_bot_username","last_test_at","last_test_status"],"format":{"transport":"truncate","last_test_at":"relative-time","last_test_status":"enum-badge"},"enumColorMap":{"last_test_status":{"ok":{"label":"✓ ok","color":"green"},"*":{"label":"✕ <value>","color":"red"},"null":{"label":"—","color":"dim"}}},"emptyMessage":"(no push transports registered)"} }, (client) => pushConfigGet({
      client,
    }))
  })

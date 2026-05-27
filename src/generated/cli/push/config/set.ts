// AUTO-GENERATED — DO NOT EDIT (source: push_config_set)
import { Command } from "commander"
import { pushConfigSet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const pushConfigSetCommand = new Command("set")
  .description("Register or update a push transport")
  .option("--transport <value>", "transport")
  .option("--target-bot-username <value>", "target_bot_username")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await pushConfigSet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        config: {
          transport: opts.transport,
          target_bot_username: opts.targetBotUsername,
        },
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "push_config_set", display: {"shape":"object","fields":["transport","target_bot_username"],"format":{"transport":"truncate"}} }, result.data)
  })

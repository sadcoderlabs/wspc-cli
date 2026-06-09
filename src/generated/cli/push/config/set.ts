// AUTO-GENERATED — DO NOT EDIT (source: push_config_set)
import { Command } from "commander"
import { pushConfigSet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const pushConfigSetCommand = new Command("set")
  .description("Register or update a push transport")
  .option("--transport <value>", "Transport discriminator. `telegram` is the only supported value today — push delivers via a Telegram bot DM. Future transports (web push, iOS/Android, generic webhook) will be added as additional discriminator values.")
  .option("--target-bot-username <value>", "Telegram bot username (with leading `@`, 5–32 alphanumeric/underscore characters). This is the bot the user has already started a chat with — wspc DMs notifications to it via the Telegram Bot API.")
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

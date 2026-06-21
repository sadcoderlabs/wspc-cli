// AUTO-GENERATED — DO NOT EDIT (source: push_config_set)
import { Command } from "commander"
import { pushConfigSet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const pushConfigSetCommand = new Command("set")
  .description("Register or update a push transport")
  .option("--transport <value>", "Transport discriminator. `telegram` is the only supported value today — push delivers via a Telegram bot DM. Future transports (web push, iOS/Android, generic webhook) will be added as additional discriminator values.")
  .option("--target-bot-username <value>", "Telegram bot username (with leading `@`, 5–32 alphanumeric/underscore characters). This is the bot the user has already started a chat with — wspc DMs notifications to it via the Telegram Bot API.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "push_config_set", display: {"shape":"object","fields":["transport","target_bot_username"],"format":{"transport":"truncate"}} }, (client) => pushConfigSet({
      client,
      body: {
        config: {
          transport: opts.transport,
          target_bot_username: opts.targetBotUsername,
        },
      },
    }))
  })

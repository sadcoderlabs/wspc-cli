// AUTO-GENERATED — DO NOT EDIT (source: push_config_set)
import { Command } from "commander"
import { pushConfigSet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const pushConfigSetCommand = new Command("set")
  .description("Register or update a push transport")
  .addHelpText("after", "\n### Overview\nUpsert a notification transport configuration for the authenticated user. After registration, wspc can dispatch notifications to the user when registered product events fire.\n\n### When to Use\nFirst-time onboarding push configuration setup, or whenever the user updates their transport target details (e.g., pointing notifications to a new Telegram bot username).\n\n### Constraints\n- **Supported Transports**: Currently only `transport: telegram` is supported.\n- **Target Validation**: `target_bot_username` must be a valid Telegram bot name starting with `@` followed by 5–32 alphanumeric/underscore characters (`^@[A-Za-z0-9_]{5,32}$`).\n- **Uniqueness**: Up to one registration row is saved per `(user_id, transport)`. Upserting replaces any existing target config, updating `updated_at` while retaining `created_at`.\n- **No Side-effect Messages**: Registering a transport does **not** send a test notification; clients should separately trigger `POST /push/test`.\n\n### Troubleshooting\n- Returns 400 `INVALID_CONFIG` if payload structure is invalid or `target_bot_username` validation fails.\n")
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

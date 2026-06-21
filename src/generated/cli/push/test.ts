// AUTO-GENERATED — DO NOT EDIT (source: push_test)
import { Command } from "commander"
import { pushTest } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const pushTestCommand = new Command("test")
  .description("Send a test push notification")
  .option("--transport <value>", "Which transport to send the test message through. Must match a transport the caller has already registered via `POST /push/config`; today only `telegram` is supported.")
  .action(async (opts) => {
    const result = await runSdkCommand({ kind: "push_test", display: {"shape":"object","fields":["ok","status","detail","durationMs"],"format":{"ok":"bool-badge"}} }, (client) => pushTest({
      client,
      body: {
        transport: opts.transport,
      },
    }))
    if (result?.data?.ok === false) {
      process.exit(1)
    }
  })

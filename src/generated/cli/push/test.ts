// AUTO-GENERATED — DO NOT EDIT (source: push_test)
import { Command } from "commander"
import { pushTest } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const pushTestCommand = new Command("test")
  .description("Send a test push notification")
  .option("--transport <value>", "Which transport to send the test message through. Must match a transport the caller has already registered via `POST /push/config`; today only `telegram` is supported.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await pushTest({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        transport: opts.transport,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "push_test", display: {"shape":"object","fields":["ok","status","detail","durationMs"],"format":{"ok":"bool-badge"}} }, result.data)
    if (result.data?.ok === false) {
      process.exit(1)
    }
  })

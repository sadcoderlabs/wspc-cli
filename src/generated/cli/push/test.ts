// AUTO-GENERATED — DO NOT EDIT (source: push_test)
import { Command } from "commander"
import { pushTest } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const pushTestCommand = new Command("test")
  .description("Send a test push notification")
  .addHelpText("after", "\n### Overview\nSynchronously dispatch a static test message via the requested transport target to verify delivery health.\n\n### When to Use\nImmediately after executing `POST /push/config` to verify connection legitimacy, or when troubleshooting missing notification claims.\n\n### Constraints\n- **Target Requirement**: You must have already successfully registered the targeted transport configuration.\n- **Side Effects**: Sends a single probe message to the upstream provider (e.g. Telegram Bot API). Test details are persisted to the configuration row under `last_test_at` and `last_test_status`.\n- **No Audit Footprint**: This operation is treated strictly as an integration probe and will not generate a product audit log footprint.\n\n### Troubleshooting\n- **Upstream Error Handling**: This endpoint returns an HTTP `200 OK` status even if the upstream dispatch fails. Callers must inspect `ok: false` and review `status` and `detail` in the response JSON to verify connection health.\n- Returns 404 `NO_CONFIG` if the user has not registered configuration details for the requested transport.\n")
  .option("--transport <value>", "Which transport to send the test message through. Must match a transport the caller has already registered via `POST /push/config`; today only `telegram` is supported.")
  .action(async (opts) => {
    const data = await runSdkCommand({
      operation: pushTest,
      input: {
        body: {
          transport: opts.transport,
        },
      },
      context: { kind: "push_test", display: {"shape":"object","fields":["ok","status","detail","durationMs"],"format":{"ok":"bool-badge"}} },
    })
    if (data?.ok === false) {
      process.exitCode = 1
    }
  })

// AUTO-GENERATED — DO NOT EDIT (source: push_config_delete)
import { Command } from "commander"
import { pushConfigDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const pushConfigDeleteCommand = new Command("rm")
  .description("Remove a push transport")
  .addHelpText("after", "\n### Overview\nDelete the configured push transport row, immediately halting push event dispatching for the caller.\n\n### When to Use\nWhen a user disconnects their notification channel, turns off push preferences, or resets their transport target.\n\n### Constraints\n- **Idempotency**: Deleting a transport that has not been registered (or was already deleted) is handled as a no-op, returning 204 `No Content`.\n- **Side Effects**: Hard-deletes the `(user_id, transport)` configuration record and completely purges all associated test history (`last_test_at` and `last_test_status`).\n- **Transport Support**: The path parameter must be a recognized transport identifier.\n\n### Troubleshooting\n- Returns 400 `UNKNOWN_TRANSPORT` if the transport parameter contains an unrecognized transport identifier.\n")
  .argument("<transport>", "transport")
  .action(async (transport, opts) => {
    const client = await loadSdkClient()
    const result = await pushConfigDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        transport,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "push_config_delete", display: undefined }, result.data)
  })

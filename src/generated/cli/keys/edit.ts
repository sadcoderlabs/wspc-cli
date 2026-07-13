// AUTO-GENERATED — DO NOT EDIT (source: key_update)
import { Command } from "commander"
import { keyUpdate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const keyUpdateCommand = new Command("edit")
  .description("Update an active API key's label")
  .addHelpText("after", "\n### Overview\nUpdates the human-readable label of an active API key. Only active (non-revoked) keys owned by the authenticated user can be updated.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Label Validation**: The `label` parameter must be between 1 and 60 characters after trimming whitespace. Failing to provide a valid label results in an `INVALID_LABEL` error.\n")
  .argument("<id>", "id")
  .option("--label <value>", "Human-readable label for the key (1–60 chars after trimming).")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await keyUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        label: opts.label,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "key_update", display: undefined }, result.data)
  })

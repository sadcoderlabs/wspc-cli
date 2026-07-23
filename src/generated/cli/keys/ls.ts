// AUTO-GENERATED — DO NOT EDIT (source: key_list)
import { Command } from "commander"
import { keyList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const keyListCommand = new Command("ls")
  .description("List active API keys")
  .addHelpText("after", "\n### Overview\nReturns a list of all active (non-revoked) API keys belonging to the authenticated user. It also includes the `current_key_id` identifying the specific key used to authenticate the current request.\n\n### When to Use\n- Use this endpoint to view active API keys (e.g., when running `wspc keys list` or displaying API key management screens in user profiles).\n- Use the `current_key_id` to identify which key is making the current call, facilitating self-rotation or auditing.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Only active keys are returned; keys that have been revoked are filtered out and excluded from the response.\n- The full secret key is never returned; only the last 4 characters (`key_last4`) are provided for identification.\n\n### Troubleshooting\n- **401 Unauthorized**: The provided Bearer token is missing, expired, or invalid. Ensure you are passing a valid, active API key.\n")
  .action(async (opts) => {
    await runSdkCommand({
      operation: keyList,
      input: {
      },
      context: { kind: "key_list", display: {"shape":"list","dataPath":"keys","columns":["id","label","last_4","created_at","last_used_at"],"format":{"id":"id-short","created_at":"relative-time","last_used_at":"relative-time"},"emptyMessage":"(no API keys)"} },
    })
  })

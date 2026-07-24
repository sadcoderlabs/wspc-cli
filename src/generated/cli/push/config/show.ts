// AUTO-GENERATED — DO NOT EDIT (source: push_config_get)
import { Command } from "commander"
import { pushConfigGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const pushConfigGetCommand = new Command("show")
  .description("List the caller's push transports")
  .addHelpText("after", "\n### Overview\nRetrieve all active push transport configurations registered for the authenticated user.\n\n### When to Use\nRender settings page, determine if push notifications are enabled before prompting the user, or fetch historical health check results (`last_test_at` and `last_test_status`).\n\n### Constraints\n- **List Limitations**: Currently returns at most one active registration row (`telegram`).\n- **Data Security**: Response payload contains sensitive data (e.g. `target_bot_username`). Callers must handle these values as user secret-equivalent and prevent leakage.\n\n### Troubleshooting\n- Standard 401 Unauthorized or 403 Forbidden checks if authentication credentials are missing or invalid.\n")
  .action(async (opts) => {
    await runSdkCommand({
      operation: pushConfigGet,
      input: {
      },
      context: { kind: "push_config_get", display: {"shape":"list","dataPath":"configs","columns":["transport","target_bot_username","last_test_at","last_test_status"],"format":{"transport":"truncate","last_test_at":"relative-time","last_test_status":"enum-badge"},"enumColorMap":{"last_test_status":{"ok":{"label":"✓ ok","color":"green"},"*":{"label":"✕ <value>","color":"red"},"null":{"label":"—","color":"dim"}}},"emptyMessage":"(no push transports registered)"} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_alias_restore)
import { Command } from "commander"
import { emailAliasRestore } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailAliasRestoreCommand = new Command("restore")
  .description("Restore a soft-deleted alias")
  .addHelpText("after", "\n### Overview\nReactivates a previously soft-deleted email receiving alias, immediately resuming mail forwarding to the user's inbox.\n\n### When to Use\n- Use this endpoint to re-enable a temporarily disabled alias or to recover one that was deleted by mistake.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Quota Check**: Reactivating an alias increases the active alias count towards the user's maximum quota of 10 active aliases. If the limit is exceeded, a `429 ALIAS_LIMIT_EXCEEDED` error is returned.\n- **Path Parameter**: The `@` character in the path parameter must be URL-encoded as `%40`.\n\n### Troubleshooting\n- **401 Unauthorized**: Missing or invalid token.\n- **404 Not Found**: No soft-deleted alias with this exact address was found for the authenticated user.\n- **429 Too Many Requests / ALIAS_LIMIT_EXCEEDED**: Reactivating this alias would exceed the per-user limit of 10 active aliases.\n")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    await runSdkCommand({
      operation: emailAliasRestore,
      input: {
        path: {
          email,
        },
      },
      context: { kind: "email_alias_restore", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

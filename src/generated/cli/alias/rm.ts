// AUTO-GENERATED — DO NOT EDIT (source: email_alias_delete)
import { Command } from "commander"
import { emailAliasDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailAliasDeleteCommand = new Command("rm")
  .description("Soft-delete an alias")
  .addHelpText("after", "\n### Overview\nSoft-deletes a specific active email receiving alias owned by the caller. Once soft-deleted, the alias stops accepting and forwarding any new inbound emails.\n\n### When to Use\n- Use this endpoint when decommissioning a disposable alias address that is no longer needed or is receiving excessive spam.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Data Retention**: Soft-deletion is immediate. Inbound mail forwarding stops, but historical emails previously received on this alias remain fully readable in the inbox.\n- **Restoration**: The alias remains globally reserved and cannot be created fresh by anyone; use `POST /email/aliases/{email}/restore` to reactivate.\n- **Path Parameter**: The `@` character in the `{email}` path parameter must be URL-encoded as `%40`.\n\n### Troubleshooting\n- **401 Unauthorized**: Missing or invalid token.\n- **404 Not Found**: No active alias with this exact address was found for the authenticated user, or the alias is already deleted.\n")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    await runSdkCommand({
      operation: emailAliasDelete,
      input: {
        path: {
          email,
        },
      },
      context: { kind: "email_alias_delete", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_alias_transfer)
import { Command } from "commander"
import { emailAliasTransfer } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailAliasTransferCommand = new Command("transfer")
  .description("Transfer an alias to another Workspace Member")
  .addHelpText("after", "\n### Overview\nMakes another active Workspace Member the Alias Holder of an active alias in the caller's Workspace. Mail received after the transfer goes to the new Alias Holder, and only the new Alias Holder can send from the address.\n\n### When to Use\n- Use this endpoint when a member leaves or changes role and someone else must keep receiving and answering mail at the address.\n- Get the target `user_id` from `GET /auth/me/org/members`.\n\n### Constraints\n- **Permission**: Only the Workspace Owner or an admin, signed in with OAuth. API keys are rejected. An admin cannot transfer an alias held by the Workspace Owner.\n- **Existing mail is not moved**: Emails received or sent before the transfer stay with the previous Alias Holder.\n- **Unchanged fields**: The address, Workspace, and `created_at` stay the same. Transferring to the current Alias Holder returns `200` and changes nothing.\n- **Limit Check**: A custom-domain alias counts toward the target's limit of 10 active aliases. A platform alias uses Workspace capacity, which a transfer does not change.\n- **Path Parameter**: The `@` character in the path parameter must be URL-encoded as `%40`.\n\n### Troubleshooting\n- **400 Bad Request / VALIDATION_ERROR**: The body has no valid `to_user_id`.\n- **403 Forbidden / WORKSPACE_FORBIDDEN**: The caller is a member, used an API key, or is an admin transferring the Owner's alias.\n- **404 Not Found / ALIAS_NOT_FOUND**: No active alias with this address exists in the caller's Workspace.\n- **422 Unprocessable Entity / ALIAS_TRANSFER_TARGET_INVALID**: The target is not an active member of the caller's Workspace.\n- **429 Too Many Requests / ALIAS_LIMIT_EXCEEDED**: The target already holds 10 active custom-domain-limited aliases.\n- **503 Service Unavailable / ALIAS_TRANSFER_UNAVAILABLE**: Workspace membership could not be checked. Nothing changed; retry later.\n\nExamples:\n  $ wspc alias transfer alice-shop@wspc.app --to-user-id usr_xxx\n")
  .argument("<email>", "email")
  .option("--to-user-id <value>", "User ID of the active Workspace Member who becomes the new Alias Holder. Find it with `GET /auth/me/org/members`.")
  .action(async (email, opts) => {
    await runSdkCommand({
      operation: emailAliasTransfer,
      input: {
        path: {
          email,
        },
        body: {
          to_user_id: opts.toUserId,
        },
      },
      context: { kind: "email_alias_transfer", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

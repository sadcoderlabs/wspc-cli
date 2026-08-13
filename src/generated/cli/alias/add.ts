// AUTO-GENERATED — DO NOT EDIT (source: email_alias_create)
import { Command } from "commander"
import { emailAliasCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailAliasCreateCommand = new Command("add")
  .description("Create a receiving alias")
  .addHelpText("after", "\n### Overview\nReserves and provisions a new passwordless/disposable receiving email alias address under the configured WSPC domain or a fully verified organization custom domain. All inbound emails received on this alias will be forwarded into the caller's inbox.\n\n### When to Use\n- Use this endpoint to spin up a fresh, dedicated email address (e.g., `alice-shop@wspc.app`) for specific websites, newsletters, or contexts to prevent spam or categorize incoming mail.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Alias Formatting**: The local part must be between 5 and 32 characters, start with an alphanumeric character, and only contain letters, numbers, dots, underscores, and hyphens.\n- **Custom Domains**: If the address uses a non-platform host, that domain must be registered to the caller's organization, fully verified, and enabled by the Workspace entitlement.\n- **Limit Check**: Reserved platform addresses use the Current Workspace tier limit (Free 3, Personal 10, Startup 40, Business 200) for both active capacity and a Workspace-wide rolling 30-day creation budget. Soft-deleted platform addresses release active capacity but remain in the creation budget until their original creation leaves the window. Custom-domain aliases use the per-user limit of 10 active aliases.\n\n### Troubleshooting\n- **401 Unauthorized**: Bearer token is missing, invalid, or expired.\n- **400 Bad Request / INVALID_CHARSET / RESERVED**: The alias local part contains invalid characters, is too short/long, or matches a reserved keyword.\n- **400 Bad Request / ALIAS_DOMAIN_NOT_FOUND**: The custom domain is not registered to the caller's organization.\n- **400 Bad Request / UNVERIFIED_DOMAIN**: The custom domain exists but is not verified yet.\n- **400 Bad Request / ALIAS_DOMAIN_NOT_READY**: The custom domain is not fully verified, enabled, or currently within entitlement.\n- **409 Conflict / ALIAS_CONFLICT**: An alias with the exact requested email address already exists globally (whether active or soft-deleted by any user).\n- **429 Too Many Requests / ALIAS_LIMIT_EXCEEDED**: The Current Workspace has reached its reserved platform address capacity, or the caller has reached the custom-domain per-user alias limit.\n- **429 Too Many Requests / ALIAS_CREATION_LIMIT_EXCEEDED**: The Workspace exhausted its rolling 30-day platform-address creation budget. Retry timing is in the `Retry-After` header.\n- **503 Service Unavailable / EMAIL_ENTITLEMENTS_UNAVAILABLE**: Billing could not provide a trustworthy entitlement, so creation failed closed.\n")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    await runSdkCommand({
      operation: emailAliasCreate,
      input: {
        body: {
          email,
        },
      },
      context: { kind: "email_alias_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} },
    })
  })

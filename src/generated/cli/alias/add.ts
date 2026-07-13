// AUTO-GENERATED — DO NOT EDIT (source: email_alias_create)
import { Command } from "commander"
import { emailAliasCreate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailAliasCreateCommand = new Command("add")
  .description("Create a receiving alias")
  .addHelpText("after", "\n### Overview\nReserves and provisions a new passwordless/disposable receiving email alias address under the configured WSPC domain or a fully verified organization custom domain. All inbound emails received on this alias will be forwarded into the caller's inbox.\n\n### When to Use\n- Use this endpoint to spin up a fresh, dedicated email address (e.g., `alice-shop@wspc.app`) for specific websites, newsletters, or contexts to prevent spam or categorize incoming mail.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Alias Formatting**: The local part must be between 5 and 32 characters, start with an alphanumeric character, and only contain letters, numbers, dots, underscores, and hyphens.\n- **Custom Domains**: If the address uses a non-platform host, that domain must be registered to the caller's organization and have `status = verified`, `sending_status = verified`, and `receiving_status = verified`.\n- **Limit Check**: Each user is allowed a maximum of 10 active email aliases. Soft-deleted aliases do not count against this quota limit.\n\n### Troubleshooting\n- **401 Unauthorized**: Bearer token is missing, invalid, or expired.\n- **400 Bad Request / INVALID_CHARSET / RESERVED**: The alias local part contains invalid characters, is too short/long, or matches a reserved keyword.\n- **400 Bad Request / ALIAS_DOMAIN_NOT_FOUND**: The custom domain is not registered to the caller's organization.\n- **400 Bad Request / UNVERIFIED_DOMAIN**: The custom domain exists but is not verified yet.\n- **400 Bad Request / ALIAS_DOMAIN_NOT_READY**: The custom domain exists but has not completed sending or receiving verification.\n- **409 Conflict / ALIAS_CONFLICT**: An alias with the exact requested email address already exists globally (whether active or soft-deleted by any user).\n- **429 Too Many Requests / ALIAS_LIMIT_EXCEEDED**: The user has reached the active alias cap limit of 10. A previously deleted alias must be cleaned up or wait for quota availability.\n")
  .argument("<email>", "email")
  .action(async (email, opts) => {
    const client = await loadSdkClient()
    const result = await emailAliasCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        email,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_alias_create", display: {"shape":"object","format":{"id":"id-short","user_id":"id-short","created_at":"relative-time","deleted_at":"relative-time"}} }, result.data)
  })

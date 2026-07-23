// AUTO-GENERATED — DO NOT EDIT (source: email_domain_delete)
import { Command } from "commander"
import { emailDomainDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailDomainDeleteCommand = new Command("rm")
  .description("Delete a custom email domain")
  .addHelpText("after", "\n### Overview\nDeletes one active custom email domain for the caller organization. The worker first confirms no active aliases use the domain, deletes the upstream provider resource, then soft-deletes the cached D1 row.\n\n### When to Use\n- Use this when an organization no longer wants WSPC to manage a custom email domain.\n- Delete is only allowed when no active aliases use the domain.\n- Deleted domains are hidden from active list/get/verify/delete surfaces and cannot be self-restored in this version.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- This route requires custom domain provider credentials in production because it performs a live provider delete call.\n- Provider identifiers and provider raw errors are never returned to the client.\n\n### Troubleshooting\n- **400 Bad Request / DOMAIN_INVALID / DOMAIN_RESERVED**: The path hostname is malformed or reserved.\n- **404 Not Found / DOMAIN_NOT_FOUND**: The domain does not exist, belongs to another organization, or was already deleted.\n- **409 Conflict / DOMAIN_IN_USE**: Active aliases still use this domain.\n- **502 Bad Gateway / DOMAIN_PROVIDER_ERROR**: Provider delete failed, timed out, or credentials are missing.\n")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({
      operation: emailDomainDelete,
      input: {
        path: {
          domain,
        },
      },
      context: { kind: "email_domain_delete", display: undefined },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_domain_verify)
import { Command } from "commander"
import { emailDomainVerify } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailDomainVerifyCommand = new Command("verify")
  .description("Verify a custom domain with the provider")
  .addHelpText("after", "\n### Overview\nTriggers an upstream provider verification attempt for one custom email domain, refreshes the cached DNS records/status in D1, and returns the updated row.\nThis route refreshes DNS registration and verification state. Custom-domain aliases require `status`, `sending_status`, and `receiving_status` to all be `verified`.\n\n### When to Use\n- Use this after publishing the required DNS records, or whenever you want to refresh cached provider state explicitly.\n- If the provider verify call returns incomplete DNS records, the worker performs a follow-up provider read before responding.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- This route requires custom domain provider credentials in production because it performs live provider calls.\n- Verification is asynchronous provider work; a successful response may still report `status: pending`.\n- `sending_status: verified` enables custom-domain outbound send for active aliases; aggregate `status: verified` and `receiving_status: verified` are also required before new custom-domain aliases can be created.\n\n### Troubleshooting\n- **400 Bad Request / DOMAIN_INVALID / DOMAIN_RESERVED**: The path hostname is malformed or reserved.\n- **404 Not Found / DOMAIN_NOT_FOUND**: The domain does not exist or belongs to another organization.\n- **502 Bad Gateway / DOMAIN_PROVIDER_ERROR**: Provider verification failed, timed out, or credentials are missing.\n")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({
      operation: emailDomainVerify,
      input: {
        path: {
          domain,
        },
      },
      context: { kind: "email_domain_verify", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} },
    })
  })

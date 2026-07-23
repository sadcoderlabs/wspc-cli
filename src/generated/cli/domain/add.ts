// AUTO-GENERATED — DO NOT EDIT (source: email_domain_create)
import { Command } from "commander"
import { emailDomainCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailDomainCreateCommand = new Command("add")
  .description("Register a custom email domain")
  .addHelpText("after", "\n### Overview\nRegisters a new organization-owned custom email domain with the upstream provider and caches the returned DNS verification records in D1.\n\n### When to Use\n- Use this endpoint when onboarding a new custom email domain such as `mail.example.com`.\n- The response contains the DNS records the organization must publish before the domain can be verified.\n- This route registers the domain and returns DNS records. Custom-domain aliases require `status`, `sending_status`, and `receiving_status` to all be `verified`.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Domain ownership is globally unique across the platform. Once any organization has reserved a domain, another org cannot register it.\n- This route requires custom domain provider credentials in production because it performs a live provider registration call.\n\n### Troubleshooting\n- **400 Bad Request / DOMAIN_INVALID / DOMAIN_RESERVED**: The hostname is malformed or belongs to the platform (`wspc.app` or its subdomains).\n- **409 Conflict / DOMAIN_CONFLICT**: The domain is already registered by some organization.\n- **502 Bad Gateway / DOMAIN_PROVIDER_ERROR**: The upstream provider request failed, timed out, or returned an unexpected shape.\n")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({
      operation: emailDomainCreate,
      input: {
        body: {
          domain,
        },
      },
      context: { kind: "email_domain_create", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} },
    })
  })

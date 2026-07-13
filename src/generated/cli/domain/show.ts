// AUTO-GENERATED — DO NOT EDIT (source: email_domain_get)
import { Command } from "commander"
import { emailDomainGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailDomainGetCommand = new Command("show")
  .description("Get one cached custom domain")
  .addHelpText("after", "\n### Overview\nReturns the caller organization's cached state for one custom email domain. This is a pure D1 read and never calls the upstream provider.\n\n### When to Use\n- Use this to inspect the latest cached DNS records or verification status for a single domain.\n- This cached view includes ownership, sending readiness, and receiving readiness state for custom-domain alias decisions.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- The `{domain}` path parameter is normalized and validated server-side before lookup.\n\n### Troubleshooting\n- **400 Bad Request / DOMAIN_INVALID / DOMAIN_RESERVED**: The path hostname is malformed or reserved.\n- **404 Not Found / DOMAIN_NOT_FOUND**: The domain does not exist or belongs to another organization.\n")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    const client = await loadSdkClient()
    const result = await emailDomainGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        domain,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_domain_get", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} }, result.data)
  })

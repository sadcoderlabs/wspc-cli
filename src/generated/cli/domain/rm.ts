// AUTO-GENERATED — DO NOT EDIT (source: email_domain_delete)
import { Command } from "commander"
import { emailDomainDelete } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailDomainDeleteCommand = new Command("rm")
  .description("Delete a custom email domain")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    const client = await loadSdkClient()
    const result = await emailDomainDelete({
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
    render({ kind: "email_domain_delete", display: undefined }, result.data)
  })

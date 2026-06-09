// AUTO-GENERATED — DO NOT EDIT (source: email_domain_get)
import { Command } from "commander"
import { emailDomainGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailDomainGetCommand = new Command("show")
  .description("Get one cached custom domain")
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

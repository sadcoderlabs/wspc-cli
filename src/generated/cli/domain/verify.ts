// AUTO-GENERATED — DO NOT EDIT (source: email_domain_verify)
import { Command } from "commander"
import { emailDomainVerify } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDomainVerifyCommand = new Command("verify")
  .description("Verify a custom domain with the provider")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({ kind: "email_domain_verify", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} }, (client) => emailDomainVerify({
      client,
      path: {
        domain,
      },
    }))
  })

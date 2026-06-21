// AUTO-GENERATED — DO NOT EDIT (source: email_domain_get)
import { Command } from "commander"
import { emailDomainGet } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDomainGetCommand = new Command("show")
  .description("Get one cached custom domain")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({ kind: "email_domain_get", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} }, (client) => emailDomainGet({
      client,
      path: {
        domain,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_domain_create)
import { Command } from "commander"
import { emailDomainCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDomainCreateCommand = new Command("add")
  .description("Register a custom email domain")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({ kind: "email_domain_create", display: {"shape":"object","format":{"created_at":"relative-time","updated_at":"relative-time","verified_at":"relative-time"},"dataPath":"domain"} }, (client) => emailDomainCreate({
      client,
      body: {
        domain,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: email_domain_delete)
import { Command } from "commander"
import { emailDomainDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDomainDeleteCommand = new Command("rm")
  .description("Delete a custom email domain")
  .argument("<domain>", "domain")
  .action(async (domain, opts) => {
    await runSdkCommand({ kind: "email_domain_delete", display: undefined }, (client) => emailDomainDelete({
      client,
      path: {
        domain,
      },
    }))
  })

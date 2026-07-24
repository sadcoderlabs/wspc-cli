// AUTO-GENERATED — DO NOT EDIT (source: email_domain_list)
import { Command } from "commander"
import { emailDomainList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailDomainListCommand = new Command("ls")
  .description("List cached custom domains")
  .addHelpText("after", "\n### Overview\nReturns the caller organization's cached custom email domains from D1. This route does not call the upstream provider.\n\n### When to Use\n- Use this to render an admin view of all registered domains and their latest known verification state.\n- Use it to inspect DNS records that were previously fetched during create or verify operations.\n- The cached state includes DNS ownership, sending readiness, and receiving readiness used by custom-domain alias creation.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Results are scoped to the caller organization and sorted newest-first by creation time.\n")
  .action(async (opts) => {
    await runSdkCommand({
      operation: emailDomainList,
      input: {
      },
      context: { kind: "email_domain_list", display: {"shape":"list","columns":["domain","status","sending_status","receiving_status","updated_at"],"format":{"updated_at":"relative-time","verified_at":"relative-time"},"emptyMessage":"no domains","dataPath":"domains"} },
    })
  })

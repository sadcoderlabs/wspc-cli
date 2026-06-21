// AUTO-GENERATED — DO NOT EDIT (source: email_domain_list)
import { Command } from "commander"
import { emailDomainList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailDomainListCommand = new Command("ls")
  .description("List cached custom domains")
  .action(async (opts) => {
    await runSdkCommand({ kind: "email_domain_list", display: {"shape":"list","columns":["domain","status","sending_status","receiving_status","updated_at"],"format":{"updated_at":"relative-time","verified_at":"relative-time"},"emptyMessage":"no domains","dataPath":"domains"} }, (client) => emailDomainList({
      client,
    }))
  })

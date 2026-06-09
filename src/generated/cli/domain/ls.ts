// AUTO-GENERATED — DO NOT EDIT (source: email_domain_list)
import { Command } from "commander"
import { emailDomainList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailDomainListCommand = new Command("ls")
  .description("List cached custom domains")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await emailDomainList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_domain_list", display: {"shape":"list","columns":["domain","status","sending_status","receiving_status","updated_at"],"format":{"updated_at":"relative-time","verified_at":"relative-time"},"emptyMessage":"no domains","dataPath":"domains"} }, result.data)
  })

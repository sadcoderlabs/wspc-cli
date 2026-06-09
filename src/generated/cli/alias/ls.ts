// AUTO-GENERATED — DO NOT EDIT (source: email_alias_list)
import { Command } from "commander"
import { emailAliasList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailAliasListCommand = new Command("ls")
  .description("List the caller's aliases")
  .option("--include-deleted <value>", "When `true`, include soft-deleted aliases (with `deleted_at` set) alongside active ones. Defaults to `false`.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await emailAliasList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_alias_list", display: {"shape":"list","columns":["id","email","label","created_at"],"format":{"id":"id-short","label":"truncate","created_at":"relative-time"},"emptyMessage":"no aliases"} }, result.data)
  })

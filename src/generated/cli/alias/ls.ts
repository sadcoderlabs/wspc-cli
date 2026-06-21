// AUTO-GENERATED — DO NOT EDIT (source: email_alias_list)
import { Command } from "commander"
import { emailAliasList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const emailAliasListCommand = new Command("ls")
  .description("List the caller's aliases")
  .option("--include-deleted <value>", "When `true`, include soft-deleted aliases (with `deleted_at` set) alongside active ones. Defaults to `false`.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "email_alias_list", display: {"shape":"list","columns":["id","email","label","created_at"],"format":{"id":"id-short","label":"truncate","created_at":"relative-time"},"emptyMessage":"no aliases"} }, (client) => emailAliasList({
      client,
      query: {
        include_deleted: opts.includeDeleted,
      },
    }))
  })

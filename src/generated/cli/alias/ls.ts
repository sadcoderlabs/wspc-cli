// AUTO-GENERATED — DO NOT EDIT (source: email_alias_list)
import { Command } from "commander"
import { emailAliasList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailAliasListCommand = new Command("ls")
  .description("List the caller's aliases")
  .addHelpText("after", "\n### Overview\nRetrieves a list of all email receiving aliases owned by the authenticated user.\n\n### When to Use\n- Use this endpoint to render an alias directory in user profiles or to provide a selection list of verified sender aliases in an email compose interface.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- By default, only active receiving aliases are returned. Pass `include_deleted=true` in the query to also fetch soft-deleted aliases (which have `deleted_at` timestamps set).\n\n### Troubleshooting\n- **401 Unauthorized**: Active token is missing, expired, or invalid.\n")
  .option("--include-deleted", "include_deleted")
  .action(async (opts) => {
    await runSdkCommand({
      operation: emailAliasList,
      input: {
        query: {
          include_deleted: opts.includeDeleted,
        },
      },
      context: { kind: "email_alias_list", display: {"shape":"list","columns":["id","email","label","created_at"],"format":{"id":"id-short","label":"truncate","created_at":"relative-time"},"emptyMessage":"no aliases"} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: org_update)
import { Command } from "commander"
import { orgUpdate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const orgUpdateCommand = new Command("rename")
  .description("Update the authenticated user's organization")
  .addHelpText("after", "\n### Overview\nUpdates the metadata (currently, the name) of the organization associated with the authenticated user.\n\n### Constraints\n- Requires a valid Bearer token.\n- Requires the Owner or Admin workspace role.\n- The organization name cannot be empty or purely whitespace.\n- Maximum length is capped by `MAX_ORG_NAME_LEN`.\n\nExamples:\n  $ wspc org rename \"New Name\"\n  $ wspc org rename \"New Name\" --json\n")
  .option("--name <value>", "The new name for the organization. Cannot be empty or purely whitespace.")
  .action(async (opts) => {
    await runSdkCommand({
      operation: orgUpdate,
      input: {
        body: {
          name: opts.name,
        },
      },
      context: { kind: "org_update", display: {"shape":"object","fields":["id","name","created_at","updated_at"],"format":{"id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time"}} },
    })
  })

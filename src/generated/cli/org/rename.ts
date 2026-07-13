// AUTO-GENERATED — DO NOT EDIT (source: org_update)
import { Command } from "commander"
import { orgUpdate } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const orgUpdateCommand = new Command("rename")
  .description("Update the authenticated user's organization")
  .addHelpText("after", "\n### Overview\nUpdates the metadata (currently, the name) of the organization associated with the authenticated user.\n\n### Constraints\n- Requires a valid Bearer token.\n- The organization name cannot be empty or purely whitespace.\n- Maximum length is capped by `MAX_ORG_NAME_LEN`.\n\nExamples:\n  $ wspc org rename \"New Name\"\n  $ wspc org rename \"New Name\" --json\n")
  .option("--name <value>", "The new name for the organization. Cannot be empty or purely whitespace.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await orgUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        name: opts.name,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_update", display: {"shape":"object","fields":["id","name","created_at","updated_at"],"format":{"id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time"}} }, result.data)
  })

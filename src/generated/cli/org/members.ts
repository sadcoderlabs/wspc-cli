// AUTO-GENERATED — DO NOT EDIT (source: org_members_list)
import { Command } from "commander"
import { orgMembersList } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const orgMembersListCommand = new Command("members")
  .description("List members of the authenticated user's organization")
  .option("--cursor <value>", "cursor")
  .option("--limit <value>", "limit")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await orgMembersList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        cursor: opts.cursor,
        limit: opts.limit,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_members_list", display: {"shape":"list","dataPath":"members","columns":["user_id","email","display_name","joined_at"],"format":{"user_id":"id-short","joined_at":"relative-time"}} }, result.data)
  })

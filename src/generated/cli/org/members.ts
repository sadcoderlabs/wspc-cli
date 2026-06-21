// AUTO-GENERATED — DO NOT EDIT (source: org_members_list)
import { Command } from "commander"
import { orgMembersList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const orgMembersListCommand = new Command("members")
  .description("List members of the authenticated user's organization")
  .option("--cursor <value>", "Opaque pagination cursor. Pass the `next_cursor` returned by the previous page to fetch the next slice. Omit on the first call.")
  .option("--limit <value>", "Maximum members to return. Clamped to [1, 100]. Defaults to 50.")
  .action(async (opts) => {
    await runSdkCommand({ kind: "org_members_list", display: {"shape":"list","dataPath":"members","columns":["user_id","email","display_name","joined_at"],"format":{"user_id":"id-short","joined_at":"relative-time"}} }, (client) => orgMembersList({
      client,
      query: {
        cursor: opts.cursor,
        limit: opts.limit,
      },
    }))
  })

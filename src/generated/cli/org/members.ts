// AUTO-GENERATED — DO NOT EDIT (source: org_members_list)
import { Command } from "commander"
import { orgMembersList } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const orgMembersListCommand = new Command("members")
  .description("List members of the authenticated user's organization")
  .addHelpText("after", "\n### Overview\nRetrieves a paginated list of all members belonging to the authenticated user's organization, including their basic profile information, emails, and roles.\n\n### When to Use\n- Use this endpoint to list members in command-line tools (e.g., `wspc org members ls`) or to display a team directory in a user dashboard.\n- Use this to paginate through large lists of organization members using cursor-based pagination.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Members may view the roster. Workspace Owners and Admins additionally manage non-Owner membership through the supported mutation endpoints.\n- **Pagination**: Supports cursor-based pagination. The `limit` query parameter must be a positive integer, defaulting to 50 and capped at a maximum of 100. Pass `cursor` from the previous response's `next_cursor` to fetch subsequent pages.\n\n### Troubleshooting\n- **401 Unauthorized**: The Bearer token is invalid or has expired.\n- **400 Bad Request**: The query parameters `limit` or `cursor` are malformed. Ensure `limit` is an integer between 1 and 100.\n- **404 Not Found**: The organization associated with this user was not found.\n")
  .option("--cursor <value>", "Opaque pagination cursor. Pass the `next_cursor` returned by the previous page to fetch the next slice. Omit on the first call.")
  .option("--limit <value>", "Maximum members to return. Clamped to [1, 100]. Defaults to 50.")
  .action(async (opts) => {
    await runSdkCommand({
      operation: orgMembersList,
      input: {
        query: {
          cursor: opts.cursor,
          limit: opts.limit,
        },
      },
      context: { kind: "org_members_list", display: {"shape":"list","dataPath":"members","columns":["user_id","email","role","display_name","joined_at"],"format":{"user_id":"id-short","joined_at":"relative-time"}} },
    })
  })

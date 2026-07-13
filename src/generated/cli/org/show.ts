// AUTO-GENERATED — DO NOT EDIT (source: org_get)
import { Command } from "commander"
import { orgGet } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const orgGetCommand = new Command("show")
  .description("Get the authenticated user's organization")
  .addHelpText("after", "\n### Overview\nReturns the metadata of the organization owned by the authenticated user. In the current version, this represents the user's personal organization space containing all their projects and tokens.\n\n### When to Use\n- Use this endpoint to retrieve the organization ID and name for display or context setup (e.g., when running `wspc org show` or rendering user dashboards).\n- Use this to verify that the API token / credentials are linked to a valid organization.\n\n### Constraints\n- Requires a valid Bearer token (API Key or Session Token) in the `Authorization` header.\n- In the current API version (v1), every user is automatically provisioned a single personal organization. Selecting or switching organizations is not supported.\n\n### Troubleshooting\n- **401 Unauthorized**: The provided Bearer token is missing, expired, or invalid. Verify your `Authorization` header format (`Bearer <token>`).\n- **403 Forbidden**: The token does not have access to read organization metadata.\n- **404 Not Found**: The organization associated with this token could not be found or has been deactivated.\n\nExamples:\n  $ wspc org show\n  $ wspc org show --json\n")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await orgGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "org_get", display: {"shape":"object","fields":["id","name","created_at","updated_at"],"format":{"id":"id-short","name":"truncate","created_at":"relative-time","updated_at":"relative-time"}} }, result.data)
  })

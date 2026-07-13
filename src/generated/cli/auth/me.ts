// AUTO-GENERATED — DO NOT EDIT (source: auth_me)
import { Command } from "commander"
import { authMe } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const authMeCommand = new Command("me")
  .description("Fetch the user identified by the bearer token")
  .addHelpText("after", "\n### Overview\nRetrieves the stable identity profile (user ID, email, and optional display name) of the user associated with the active Bearer token. Works for both long-lived `wspc_*` API keys and OAuth access tokens.\n\n### When to Use\n- Use this endpoint (e.g., in `wspc verify` or `wspc whoami`) to confirm that the active environment's API key or OAuth access token remains valid.\n- Use it in UIs to display the logged-in user's profile details and retrieve the stable `user_id`.\n\n### Constraints\n- Requires a valid Bearer token (either a long-lived `wspc_*` API key or a temporary OAuth access token) in the `Authorization` header.\n- **Response Fields**: The `api_key_id` field is only returned if authenticated via a WSPC API key (prefixed with `wspc_`). OAuth access tokens will omit `api_key_id`. `display_name` is omitted if not configured.\n\n### Troubleshooting\n- **401 Unauthorized**: The Bearer token is missing, malformed, or has been revoked. Ensure the `Authorization` header matches the `Bearer <token>` format.\n\nExamples:\n  $ wspc auth me\n  $ wspc auth me --json\n")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await authMe({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "auth_me", display: {"shape":"object","fields":["user_id","email","display_name","api_key_id"],"format":{"user_id":"id-short","api_key_id":"id-short"}} }, result.data)
  })

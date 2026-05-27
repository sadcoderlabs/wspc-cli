import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runWhoami } from "../auth/whoami.js"
import { loadSdkClient } from "../auth/load-sdk-client.js"
import { orgGet } from "../../generated/sdk/index.js"
import { render, registerRenderer, renderObject } from "../output/render.js"
import { bold, dim } from "../output/primitives.js"
import type { XCliDisplay } from "../output/types.js"

/**
 * `whoami` is the high-level identity overview. It composes three sources:
 *   - local config (env name, api_base, actor)        ← only place this lives
 *   - GET /auth/me   (user_id, email, display_name)   ← via runWhoami
 *   - GET /auth/me/org (org id, name, timestamps)     ← via SDK
 *
 * For JSON / piped output we emit a single combined `{ env, user, org? }`
 * object so scripts get a parseable shape. For TTY output a specific
 * renderer prints three labelled sections, reusing the generic key/value
 * renderer for the per-section table.
 */

const ENV_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["name", "api_base", "actor", "agent_label"],
}

const USER_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["user_id", "email", "display_name", "api_key_id"],
  format: {
    user_id: "id-short",
    api_key_id: "id-short",
  },
}

const ORG_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["id", "name", "created_at", "updated_at"],
  format: {
    id: "id-short",
    name: "truncate",
    created_at: "relative-time",
    updated_at: "relative-time",
  },
}

interface WhoamiPayload {
  env: Record<string, unknown>
  user: Record<string, unknown>
  org?: Record<string, unknown>
}

registerRenderer("whoami", (data) => {
  const d = data as WhoamiPayload
  process.stdout.write(bold("ENV") + "\n")
  renderObject(d.env, ENV_DISPLAY)
  process.stdout.write("\n" + bold("USER") + "\n")
  renderObject(d.user, USER_DISPLAY)
  if (d.org) {
    process.stdout.write("\n" + bold("ORG") + "\n")
    renderObject(d.org, ORG_DISPLAY)
  }
})

export const whoamiCommand = new Command("whoami")
  .description("Show the active env, signed-in user, and organization")
  .action(async () => {
    const store = new ConfigStore()
    const w = await runWhoami({ store })

    if (w.status === "logged_out") {
      process.stderr.write(dim('not logged in. run "wspc login".') + "\n")
      // Use exitCode (not process.exit) so Node finishes closing the fetch
      // response stream before exit — see auth/whoami.ts notes.
      process.exitCode = 1
      return
    }

    const current = await store.currentEnv()
    if (!current) {
      // runWhoami returned logged_in, so currentEnv must exist. Narrowed
      // here for TypeScript; this branch should be unreachable.
      process.stderr.write("error: env state inconsistent\n")
      process.exitCode = 1
      return
    }

    // Build env section from local config. Only include optional fields
    // when set so the table doesn't show "—" rows for things the user
    // never configured.
    const env: Record<string, unknown> = {
      name: current.name,
      api_base: current.config.api_base,
    }
    if (current.config.actor) env.actor = current.config.actor
    if (current.config.agent_label) env.agent_label = current.config.agent_label

    // Fetch org via SDK alongside the user we already have. Non-fatal:
    // if /auth/me/org fails (e.g. v0 envs without org provisioning) we
    // still print env + user so the command is useful for debugging.
    let org: Record<string, unknown> | undefined
    try {
      const sdk = await loadSdkClient({ store })
      const result = await orgGet({
        client: (sdk as unknown as { _rawClient: unknown })._rawClient as never,
      })
      if (result.response?.ok && result.data) {
        org = result.data as Record<string, unknown>
      }
    } catch {
      // Swallow — org section is optional polish, not the point of whoami.
    }

    render(
      { kind: "whoami" },
      { env, user: w.user, ...(org ? { org } : {}) },
    )
  })

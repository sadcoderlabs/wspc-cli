import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { loadSdkClient } from "../auth/load-sdk-client.js"
import { authMe, orgGet } from "../../generated/sdk/index.js"
import { render, registerRenderer, renderObject } from "../output/render.js"
import { bold, dim } from "../output/primitives.js"
import type { XCliDisplay } from "../output/types.js"
import { WspcAuthExpiredError } from "../../index.js"

/**
 * `whoami` is the high-level identity overview. It composes three sources:
 *   - local config (env name, api_base, actor)        ← only place this lives
 *   - GET /auth/me   (user_id, email, display_name)   ← via SDK
 *   - GET /auth/me/org (org id, name, timestamps)     ← via SDK
 *
 * SDK calls go through `loadSdkClient`, which wires the auth interceptor —
 * so a stale OAuth access token gets refreshed on 401 instead of being
 * reported as "logged_out". Without this, whoami would lag any other
 * command that runs first (the other command refreshes; whoami didn't).
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
    const current = await store.currentEnv()
    if (!current) {
      printLoggedOut()
      return
    }

    let sdkClient: Awaited<ReturnType<typeof loadSdkClient>>
    try {
      sdkClient = await loadSdkClient({ store })
    } catch {
      // loadSdkClient throws when current env has no usable creds — same
      // user-visible state as "no current env": ask them to log in.
      printLoggedOut()
      return
    }
    const client = (sdkClient as unknown as { _rawClient: unknown })._rawClient

    // Fetch user + org in parallel. /auth/me drives the logged_in decision;
    // /auth/me/org is best-effort polish (legacy envs may not provision an
    // org). We let the SDK's auth interceptor handle 401 → token refresh;
    // only if refresh itself fails (WspcAuthExpiredError) do we fall back
    // to the logged_out path.
    let user: Record<string, unknown>
    let org: Record<string, unknown> | undefined
    try {
      const [meResult, orgResult] = await Promise.all([
        authMe({ client: client as never }),
        orgGet({ client: client as never }).catch(() => null),
      ])
      if (meResult.error || !meResult.response?.ok || !meResult.data) {
        printLoggedOut()
        return
      }
      user = meResult.data as Record<string, unknown>
      if (orgResult && orgResult.response?.ok && orgResult.data) {
        org = orgResult.data as Record<string, unknown>
      }
    } catch (e) {
      if (e instanceof WspcAuthExpiredError) {
        printLoggedOut()
        return
      }
      throw e
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

    render(
      { kind: "whoami" },
      { env, user, ...(org ? { org } : {}) },
    )
  })

function printLoggedOut(): void {
  process.stderr.write(dim('not logged in. run "wspc login".') + "\n")
  // Use exitCode (not process.exit) so Node finishes closing any in-flight
  // fetch response streams before exit — avoids a libuv assertion on
  // Windows when async handles are still in CLOSING state at forced-exit.
  process.exitCode = 1
}

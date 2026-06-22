import { Command } from "commander"
import { ConfigStore, rekeyLegacyAccount } from "../config/index.js"
import { loadSdkClient } from "../auth/load-sdk-client.js"
import { resolveAccount } from "../auth/resolve-account.js"
import { authMe, orgGet } from "../../generated/sdk/index.js"
import { render, registerRenderer, renderObject } from "../output/render.js"
import { bold, dim } from "../output/primitives.js"
import type { XCliDisplay } from "../output/types.js"
import { WspcAuthExpiredError } from "../../index.js"

const ENV_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["name", "api_base", "account", "actor", "agent_label"],
}
const USER_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["user_id", "email", "display_name", "api_key_id"],
  format: { user_id: "id-short", api_key_id: "id-short" },
}
const ORG_DISPLAY: XCliDisplay = {
  shape: "object",
  fields: ["id", "name", "created_at", "updated_at"],
  format: { id: "id-short", name: "truncate", created_at: "relative-time", updated_at: "relative-time" },
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

/** Rename the migration placeholder to the real email once /auth/me resolves. */
export async function backfillActiveEmail(
  store: ConfigStore,
  envName: string,
  email: string,
  userId?: string,
): Promise<void> {
  await store.update((cfg) => {
    rekeyLegacyAccount(cfg, envName, email, userId)
  })
}

export const whoamiCommand = new Command("whoami")
  .description("Show the active env, signed-in account, and organization")
  .action(async () => {
    const store = new ConfigStore()
    const config = await store.read()

    let resolved: ReturnType<typeof resolveAccount>
    let sdkClient: Awaited<ReturnType<typeof loadSdkClient>>
    try {
      resolved = resolveAccount(config, { accountOverride: process.env.WSPC_ACCOUNT })
      sdkClient = await loadSdkClient({ store })
    } catch {
      printLoggedOut()
      return
    }
    const client = (sdkClient as unknown as { _rawClient: unknown })._rawClient

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

    // Opportunistic migration backfill: if we ran as the "(default)" placeholder,
    // rename it now that /auth/me gave us the real email.
    if (typeof user.email === "string") {
      await backfillActiveEmail(store, resolved.envName, user.email, user.user_id as string | undefined)
    }

    const env: Record<string, unknown> = {
      name: resolved.envName,
      api_base: resolved.apiBase,
      account: typeof user.email === "string" ? user.email : resolved.email,
    }
    if (resolved.creds.actor) env.actor = resolved.creds.actor
    if (resolved.creds.agent_label) env.agent_label = resolved.creds.agent_label

    render({ kind: "whoami" }, { env, user, ...(org ? { org } : {}) })
  })

function printLoggedOut(): void {
  process.stderr.write(dim('not logged in. run "wspc login".') + "\n")
  process.exitCode = 1
}

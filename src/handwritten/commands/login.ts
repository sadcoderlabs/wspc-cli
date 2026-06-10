import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runLogin } from "../auth/login.js"
import { API_BASE } from "../../version.js"

export function resolveLoginTarget(
  opts: { apiBase?: string; env?: string },
  env: NodeJS.ProcessEnv,
): { baseUrl: string; envName: string } {
  const baseUrl = opts.apiBase ?? env.WSPC_API_BASE ?? API_BASE
  // A non-prod base must not silently overwrite the prod env's api_base.
  const envName = opts.env ?? (baseUrl === API_BASE ? "prod" : "local")
  return { baseUrl, envName }
}

export const loginCommand = new Command("login")
  .description("Log in via OAuth device flow (default) or API key")
  .option("--api-key <key>", "Log in with a wspc API key (escape hatch)")
  .option("--api-base <url>", "Target API base URL (default: production)")
  .option("--env <name>", "Config env name to store credentials under")
  .option("--json", "Emit machine-readable events to stdout")
  .action(async (opts: { apiKey?: string; apiBase?: string; env?: string; json?: boolean }) => {
    const store = new ConfigStore()
    const { baseUrl, envName } = resolveLoginTarget(opts, process.env)
    const output = opts.json
      ? { write: () => {}, writeJson: (e: Record<string, unknown>) => process.stdout.write(JSON.stringify(e) + "\n") }
      : {
          write: (s: string) => process.stdout.write(s + "\n"),
          writeJson: () => {},
        }
    await runLogin({
      store,
      baseUrl,
      envName,
      apiKey: opts.apiKey,
      output,
    })
  })

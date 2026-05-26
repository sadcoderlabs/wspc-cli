import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runLogin } from "../auth/login.js"
import { API_BASE } from "../../version.js"

export const loginCommand = new Command("login")
  .description("Log in via OAuth device flow (default) or API key")
  .option("--api-key <key>", "Log in with a wspc API key (escape hatch)")
  .option("--json", "Emit machine-readable events to stdout")
  .action(async (opts: { apiKey?: string; json?: boolean }) => {
    const store = new ConfigStore()
    const output = opts.json
      ? { write: () => {}, writeJson: (e: Record<string, unknown>) => process.stdout.write(JSON.stringify(e) + "\n") }
      : {
          write: (s: string) => process.stdout.write(s + "\n"),
          writeJson: () => {},
        }
    await runLogin({
      store,
      baseUrl: API_BASE,
      apiKey: opts.apiKey,
      output,
    })
  })

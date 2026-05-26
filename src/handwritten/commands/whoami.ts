import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runWhoami } from "../auth/whoami.js"

export const whoamiCommand = new Command("whoami")
  .description("Show the currently logged-in user")
  .action(async () => {
    const r = await runWhoami({ store: new ConfigStore() })
    process.stdout.write(JSON.stringify(r, null, 2) + "\n")
    if (r.status === "logged_out") process.exit(1)
  })

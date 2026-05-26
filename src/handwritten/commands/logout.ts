import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runLogout } from "../auth/logout.js"

export const logoutCommand = new Command("logout")
  .description("Clear stored credentials for the current environment")
  .action(async () => {
    await runLogout({ store: new ConfigStore() })
    process.stdout.write("✓ logged out\n")
  })

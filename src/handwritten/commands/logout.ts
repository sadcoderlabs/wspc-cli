import { Command } from "commander"
import { ConfigStore } from "../config/index.js"
import { runLogout } from "../auth/logout.js"

export const logoutCommand = new Command("logout")
  .description("Log out an account (default: the active account in the current env)")
  .argument("[email]", "Email of the account to log out")
  .option("--all", "Log out every account in the current env")
  .action(async (email: string | undefined, opts: { all?: boolean }) => {
    const res = await runLogout({ store: new ConfigStore(), email, all: opts.all })
    if (res.removed.length === 0) {
      process.stdout.write("nothing to log out\n")
      return
    }
    process.stdout.write(`✓ logged out: ${res.removed.join(", ")}\n`)
    if (res.newActive) process.stdout.write(`active account is now ${res.newActive}\n`)
  })

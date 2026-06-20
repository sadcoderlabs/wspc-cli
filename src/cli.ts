#!/usr/bin/env node
import { Command } from "commander"
import { registerGeneratedCommands } from "./generated/cli/index.js"
import { loginCommand } from "./handwritten/commands/login.js"
import { logoutCommand } from "./handwritten/commands/logout.js"
import { whoamiCommand } from "./handwritten/commands/whoami.js"
import { configCommand } from "./handwritten/commands/config.js"
import { accountCommand } from "./handwritten/commands/account.js"
import { todoDoneCommand } from "./handwritten/commands/todo-done.js"
import { sendCommand } from "./handwritten/commands/email/send.js"
import { attachmentCommand } from "./handwritten/commands/email/attachment.js"
import { driveBindCommand } from "./handwritten/commands/drive/bind.js"
import { VERSION, SPEC_SHA, SPEC_FETCHED_AT } from "./version.js"

function buildProgram(): Command {
  const program = new Command()
    .name("wspc")
    .description("Official CLI for wspc.ai")
    .version(`wspc ${VERSION} (spec ${SPEC_SHA}, fetched ${SPEC_FETCHED_AT})`)
    // Global output mode flag. Default is pretty when stdout is a TTY,
    // JSON when piped (renderer enforces this). Pass `--json` to force JSON
    // even in a TTY — useful for ad-hoc copy/paste into scripts.
    .option("--json", "Output raw JSON (machine-readable)")
    .option("--account <email>", "Run as a specific account (overrides the active account)")
    .hook("preAction", (_thisCommand, actionCommand) => {
      const globals = actionCommand.optsWithGlobals()
      if (globals.json) process.env.WSPC_OUTPUT = "json"
      // Flag beats WSPC_ACCOUNT env: overwriting process.env achieves the
      // precedence (flag > env) because resolveAccount reads WSPC_ACCOUNT.
      if (globals.account) process.env.WSPC_ACCOUNT = String(globals.account)
    })

  program.addCommand(loginCommand)
  program.addCommand(logoutCommand)
  program.addCommand(whoamiCommand)
  program.addCommand(configCommand)
  program.addCommand(accountCommand)

  registerGeneratedCommands(program)

  const drive = new Command("drive").description("Drive commands")
  drive.addCommand(driveBindCommand())
  program.addCommand(drive)

  const todo = program.commands.find((c) => c.name() === "todo")
  if (todo) todo.addCommand(todoDoneCommand)

  // Mount handwritten email commands under the generated `email` subtree.
  // They live in handwritten/ because they need behavior (multipart-equivalent
  // base64 attachment encoding, binary stream download) that the codegen layer
  // deliberately doesn't model.
  const email = program.commands.find((c) => c.name() === "email")
  if (!email) {
    throw new Error("email command tree not found; codegen output may be missing")
  }
  email.addCommand(sendCommand)
  email.addCommand(attachmentCommand)

  return program
}

export async function dispatch(argv: string[], { allowRetry = true }: { allowRetry?: boolean } = {}): Promise<void> {
  try {
    await buildProgram().parseAsync(argv)
  } catch (err) {
    const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined
    if (code === "WSPC_AUTH_EXPIRED") {
      if (allowRetry && process.stdin.isTTY && process.stdout.isTTY) {
        process.stderr.write("session expired; re-authenticating...\n")
        await buildProgram().parseAsync(["node", "wspc", "login"])
        await dispatch(argv, { allowRetry: false })
        return
      }
      process.stderr.write(`error: ${(err as Error).message}\n`)
      // exitCode (not process.exit) so Node closes fetch / file streams
      // cleanly — avoids a libuv assertion on Windows when async handles
      // are still in CLOSING state at forced-exit time.
      process.exitCode = 2
      return
    }
    process.stderr.write(`error: ${(err as Error).message ?? err}\n`)
    process.exitCode = 1
  }
}

dispatch(process.argv)

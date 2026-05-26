#!/usr/bin/env node
import { Command } from "commander"
import { registerGeneratedCommands } from "./generated/cli/index.js"
import { loginCommand } from "./handwritten/commands/login.js"
import { logoutCommand } from "./handwritten/commands/logout.js"
import { whoamiCommand } from "./handwritten/commands/whoami.js"
import { configCommand } from "./handwritten/commands/config.js"
import { todoDoneCommand } from "./handwritten/commands/todo-done.js"
import { VERSION, SPEC_SHA, SPEC_FETCHED_AT } from "./version.js"

function buildProgram(): Command {
  const program = new Command()
    .name("wspc")
    .description("Official CLI for wspc.ai")
    .version(`wspc ${VERSION} (spec ${SPEC_SHA}, fetched ${SPEC_FETCHED_AT})`)

  program.addCommand(loginCommand)
  program.addCommand(logoutCommand)
  program.addCommand(whoamiCommand)
  program.addCommand(configCommand)

  registerGeneratedCommands(program)

  const todo = program.commands.find((c) => c.name() === "todo")
  if (todo) todo.addCommand(todoDoneCommand)

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
      process.exit(2)
    }
    process.stderr.write(`error: ${(err as Error).message ?? err}\n`)
    process.exit(1)
  }
}

dispatch(process.argv)

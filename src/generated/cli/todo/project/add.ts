// AUTO-GENERATED — DO NOT EDIT (source: project_create)
import { Command } from "commander"
import { projectCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"

export const projectCreateCommand = new Command("add")
  .description("Create a project")
  .argument("<name>", "name")
  .option("--default-todo-type-id <value>", "default_todo_type_id")
  .action(async (name, opts) => {
    const client = await loadSdkClient()
    const result = await projectCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        name,
        default_todo_type_id: opts.defaultTodoTypeId,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    if (result.data !== undefined) console.log(JSON.stringify(result.data, null, 2))
  })

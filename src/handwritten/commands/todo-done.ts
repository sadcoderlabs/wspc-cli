import { Command } from "commander"
import { loadSdkClient } from "../auth/load-sdk-client.js"
import { todoUpdate } from "../../generated/sdk/index.js"

export const todoDoneCommand = new Command("done")
  .description("Mark a todo done (sugar for `update <id> --status done`)")
  .argument("<id>", "Todo id")
  .action(async (id: string) => {
    const client = await loadSdkClient()
    const result = await todoUpdate({
      client: client._rawClient,
      path: { id },
      body: { status: "done" } as never,
    })
    process.stdout.write(JSON.stringify(result.data, null, 2) + "\n")
  })

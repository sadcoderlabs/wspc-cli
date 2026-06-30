// AUTO-GENERATED — DO NOT EDIT (source: drive_file_history)
import { Command } from "commander"
import { driveFileHistory } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveFileHistoryCommand = new Command("history")
  .description("Get drive file version history")
  .argument("<id>", "id")
  .option("--path <value>", "path")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveFileHistory({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        path: opts.path,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_file_history", display: {"shape":"list","dataPath":"versions","columns":["version_number","version_id","size_bytes","created_at"],"emptyMessage":"no versions"} }, result.data)
  })

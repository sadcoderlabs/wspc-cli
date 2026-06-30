// AUTO-GENERATED — DO NOT EDIT (source: drive_search)
import { Command } from "commander"
import { driveSearch } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const driveSearchCommand = new Command("search")
  .description("Search drive library text")
  .argument("<id>", "id")
  .option("--query <value>", "query")
  .option("--limit <value>", "limit")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveSearch({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        query: opts.query,
        limit: opts.limit,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_search", display: {"shape":"list","dataPath":"results","columns":["path","snippet"],"emptyMessage":"no matches"} }, result.data)
  })

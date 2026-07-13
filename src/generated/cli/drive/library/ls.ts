// AUTO-GENERATED — DO NOT EDIT (source: drive_library_list)
import { Command } from "commander"
import { driveLibraryList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveLibraryListCommand = new Command("ls")
  .description("List drive libraries")
  .addHelpText("after", "\nList libraries in the caller organization with cursor pagination.\n")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await driveLibraryList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        limit: opts.limit,
        cursor: opts.cursor,
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_library_list", display: {"shape":"list","dataPath":"libraries","columns":["id","name","file_count","storage_bytes","updated_at"],"emptyMessage":"no drive libraries"} }, result.data)
  })

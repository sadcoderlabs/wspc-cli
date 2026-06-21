// AUTO-GENERATED — DO NOT EDIT (source: drive_library_list)
import { Command } from "commander"
import { driveLibraryList } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveLibraryListCommand = new Command("ls")
  .description("List drive libraries")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (opts) => {
    await runSdkCommand({ kind: "drive_library_list", display: {"shape":"list","dataPath":"libraries","columns":["id","name","file_count","storage_bytes","updated_at"],"emptyMessage":"no drive libraries"} }, (client) => driveLibraryList({
      client,
      query: {
        limit: opts.limit,
        cursor: opts.cursor,
        include_deleted: opts.includeDeleted,
      },
    }))
  })

// AUTO-GENERATED — DO NOT EDIT (source: drive_search)
import { Command } from "commander"
import { driveSearch } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const driveSearchCommand = new Command("search")
  .description("Search drive library text")
  .addHelpText("after", "\nFull-text search over indexed text files in a library (FTS5).\n")
  .argument("<id>", "id")
  .option("--query <value>", "query")
  .option("--limit <value>", "limit")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveSearch,
      input: {
        path: {
          id,
        },
        query: {
          query: opts.query,
          limit: opts.limit,
        },
      },
      context: { kind: "drive_search", display: {"shape":"list","dataPath":"results","columns":["path","snippet"],"emptyMessage":"no matches"} },
    })
  })

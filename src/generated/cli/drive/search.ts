// AUTO-GENERATED — DO NOT EDIT (source: drive_search)
import { Command } from "commander"
import { driveSearch } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const driveSearchCommand = new Command("search")
  .description("Search drive library text")
  .addHelpText("after", "\nSearch indexed text files by relevance, then file ID. Pass next_cursor as cursor with the same exact query and library; stop when next_cursor is absent. No TTL or snapshot. Index changes, including other libraries, can cause repeats or omissions. Invalid cursors return VALIDATION_ERROR; restart the search. Libraries that are missing, deleted or outside the Workspace return NOT_FOUND before cursor validation.\n")
  .argument("<id>", "id")
  .option("--query <value>", "query")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "Opaque Search Cursor from next_cursor; reuse with the same query and library. No TTL.")
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
          cursor: opts.cursor,
        },
      },
      context: { kind: "drive_search", display: {"shape":"list","dataPath":"results","columns":["path","snippet"],"emptyMessage":"no matches"} },
    })
  })

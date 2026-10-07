// AUTO-GENERATED — DO NOT EDIT (source: drive_search)
import { Command } from "commander"
import { driveSearch, driveWorkspaceSearch } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const driveSearchCommand = new Command("search")
  .description("Search drive text across the Workspace")
  .addHelpText("after", "\nSearch indexed text files by substring, ordered by relevance, then file ID. Whitespace terms are ANDed. Each term needs at least 3 characters; a shorter term returns no results, so add context (日本旅遊, not 日本). path_prefix keeps only paths that start with that literal string; wildcards are not interpreted. Each result has library_id, path and snippet. Pass next_cursor as cursor with the same exact query, library scope and path_prefix; stop when next_cursor is absent. No TTL or snapshot. Index changes, including other libraries, can cause repeats or omissions. Invalid, mismatched or v1 cursors return VALIDATION_ERROR; restart the search. Searches every library in the Workspace except deleted libraries. A Workspace without libraries returns an empty page.\n")
  .argument("[id]", "id; omit to search drive text across the Workspace")
  .option("--query <value>", "query")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "Opaque Search Cursor from next_cursor; reuse with the same query, library and path_prefix. No TTL.")
  .option("--path-prefix <value>", "path_prefix")
  .action(async (id, opts) => {
    if (id === undefined) {
      await runSdkCommand({
        operation: driveWorkspaceSearch,
        input: {
          query: {
            query: opts.query,
            limit: opts.limit,
            cursor: opts.cursor,
            path_prefix: opts.pathPrefix,
          },
        },
        context: { kind: "drive_workspace_search", display: {"shape":"list","dataPath":"results","columns":["library_id","path","snippet"],"emptyMessage":"no matches"} },
      })
      return
    }
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
          path_prefix: opts.pathPrefix,
        },
      },
      context: { kind: "drive_search", display: {"shape":"list","dataPath":"results","columns":["path","snippet"],"emptyMessage":"no matches"} },
    })
  })

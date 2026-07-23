// AUTO-GENERATED — DO NOT EDIT (source: drive_manifest_get)
import { Command } from "commander"
import { driveManifestGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveManifestGetCommand = new Command("get")
  .description("Get a drive library manifest")
  .addHelpText("after", "\nList file entries for sync using path/id cursor pagination.\n")
  .argument("<id>", "id")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
  .option("--path-prefix <value>", "path_prefix")
  .option("--since-cursor <value>", "since_cursor")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveManifestGet,
      input: {
        path: {
          id,
        },
        query: {
          limit: opts.limit,
          cursor: opts.cursor,
          include_deleted: opts.includeDeleted,
          path_prefix: opts.pathPrefix,
          since_cursor: opts.sinceCursor,
        },
      },
      context: { kind: "drive_manifest_get", display: {"shape":"list","dataPath":"entries","columns":["path","entry_version","size_bytes","updated_at"],"emptyMessage":"no drive files"} },
    })
  })

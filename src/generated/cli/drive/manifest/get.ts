// AUTO-GENERATED — DO NOT EDIT (source: drive_manifest_get)
import { Command } from "commander"
import { driveManifestGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveManifestGetCommand = new Command("get")
  .description("Get a drive library manifest")
  .argument("<id>", "id")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "drive_manifest_get", display: {"shape":"list","dataPath":"entries","columns":["path","entry_version","size_bytes","updated_at"],"emptyMessage":"no drive files"} }, (client) => driveManifestGet({
      client,
      path: {
        id,
      },
      query: {
        limit: opts.limit,
        cursor: opts.cursor,
        include_deleted: opts.includeDeleted,
      },
    }))
  })

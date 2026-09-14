// AUTO-GENERATED — DO NOT EDIT (source: drive_file_history)
import { Command } from "commander"
import { driveFileHistory } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveFileHistoryCommand = new Command("history")
  .description("Get drive file version history")
  .addHelpText("after", "\nRead retained versions of one active File entry, newest first. Optional entry_id must match the active file at path. Without it, read the current active file. Metadata and versions share one snapshot. Missing or deleted files return NOT_FOUND. This read does not authorize a later restore.\n")
  .argument("<id>", "id")
  .option("--entry-id <value>", "entry_id")
  .option("--path <value>", "path")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveFileHistory,
      input: {
        path: {
          id,
        },
        query: {
          entry_id: opts.entryId,
          path: opts.path,
        },
      },
      context: { kind: "drive_file_history", display: {"shape":"list","dataPath":"versions","columns":["version_number","version_id","size_bytes","created_at"],"emptyMessage":"no versions"} },
    })
  })

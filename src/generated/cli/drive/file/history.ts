// AUTO-GENERATED — DO NOT EDIT (source: drive_file_history)
import { Command } from "commander"
import { driveFileHistory } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveFileHistoryCommand = new Command("history")
  .description("Get drive file version history")
  .addHelpText("after", "\nList stored versions of a file, newest first.\n")
  .argument("<id>", "id")
  .option("--path <value>", "path")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveFileHistory,
      input: {
        path: {
          id,
        },
        query: {
          path: opts.path,
        },
      },
      context: { kind: "drive_file_history", display: {"shape":"list","dataPath":"versions","columns":["version_number","version_id","size_bytes","created_at"],"emptyMessage":"no versions"} },
    })
  })

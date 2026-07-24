// AUTO-GENERATED — DO NOT EDIT (source: drive_file_restore)
import { Command } from "commander"
import { driveFileRestore } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveFileRestoreCommand = new Command("restore")
  .description("Restore a drive file version")
  .addHelpText("after", "\nPromote a previous file version to be the current content.\n")
  .argument("<id>", "id")
  .option("--path <value>", "path")
  .option("--version-id <value>", "version_id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveFileRestore,
      input: {
        path: {
          id,
        },
        body: {
          path: opts.path,
          version_id: opts.versionId,
        },
      },
      context: { kind: "drive_file_restore", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","updated_at"]} },
    })
  })

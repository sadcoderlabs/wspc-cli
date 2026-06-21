// AUTO-GENERATED — DO NOT EDIT (source: drive_file_delete)
import { Command } from "commander"
import { driveFileDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveFileDeleteCommand = new Command("rm")
  .description("Delete a drive file")
  .argument("<id>", "id")
  .argument("<path>", "path")
  .option("--expected-entry-version <value>", "expected_entry_version")
  .action(async (id, path, opts) => {
    await runSdkCommand({ kind: "drive_file_delete", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","deleted_at"]} }, (client) => driveFileDelete({
      client,
      path: {
        id,
      },
      body: {
        path,
        expected_entry_version: opts.expectedEntryVersion,
      },
    }))
  })

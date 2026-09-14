// AUTO-GENERATED — DO NOT EDIT (source: drive_file_delete)
import { Command } from "commander"
import { driveFileDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const driveFileDeleteCommand = new Command("rm")
  .description("Delete a drive file")
  .addHelpText("after", "\nDelete the confirmed entry and version. A confirmed current tombstone returns unchanged. Never replace the original confirmation with current values.\n")
  .argument("<id>", "id")
  .argument("<path>", "path")
  .option("--entry-id <value>", "entry_id")
  .option("--expected-entry-version <value>", "expected_entry_version", (value: string) => parseIntegerField(value, "expected-entry-version"))
  .action(async (id, path, opts) => {
    await runSdkCommand({
      operation: driveFileDelete,
      input: {
        path: {
          id,
        },
        body: {
          path,
          entry_id: opts.entryId,
          expected_entry_version: opts.expectedEntryVersion,
        },
      },
      context: { kind: "drive_file_delete", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","deleted_at"]} },
    })
  })

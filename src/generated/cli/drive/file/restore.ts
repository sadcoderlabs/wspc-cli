// AUTO-GENERATED — DO NOT EDIT (source: drive_file_restore)
import { Command } from "commander"
import { driveFileRestore } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const driveFileRestoreCommand = new Command("restore")
  .description("Restore a drive file version")
  .addHelpText("after", "\nRestore retained bytes only while the confirmed entry ID, path, and Entry Version still match. Stale confirmation fails with VERSION_CONFLICT. Same bytes return unchanged after the same atomic checks. Never fetch a newer Entry Version to retry.\n")
  .argument("<id>", "id")
  .option("--entry-id <value>", "Entry ID from the caller's confirmation.")
  .option("--path <value>", "path")
  .option("--expected-entry-version <value>", "Entry Version from the caller's confirmation. Do not fetch a newer value to retry.", (value: string) => parseIntegerField(value, "expected-entry-version"))
  .option("--version-id <value>", "version_id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveFileRestore,
      input: {
        path: {
          id,
        },
        body: {
          entry_id: opts.entryId,
          path: opts.path,
          expected_entry_version: opts.expectedEntryVersion,
          version_id: opts.versionId,
        },
      },
      context: { kind: "drive_file_restore", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","updated_at"]} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: drive_library_delete)
import { Command } from "commander"
import { driveLibraryDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const driveLibraryDeleteCommand = new Command("rm")
  .description("Delete a drive library")
  .addHelpText("after", "\nSoft-delete an empty library using optimistic version locking.\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveLibraryDelete,
      input: {
        path: {
          id,
        },
        body: {
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "drive_library_delete", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} },
    })
  })

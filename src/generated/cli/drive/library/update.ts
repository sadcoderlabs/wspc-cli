// AUTO-GENERATED — DO NOT EDIT (source: drive_library_update)
import { Command } from "commander"
import { driveLibraryUpdate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const driveLibraryUpdateCommand = new Command("update")
  .description("Update a drive library")
  .addHelpText("after", "\nRename a library using optimistic version locking.\n")
  .argument("<id>", "id")
  .option("--name <value>", "name")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveLibraryUpdate,
      input: {
        path: {
          id,
        },
        body: {
          name: opts.name,
          expected_version: opts.expectedVersion,
        },
      },
      context: { kind: "drive_library_update", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} },
    })
  })

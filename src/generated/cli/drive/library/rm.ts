// AUTO-GENERATED — DO NOT EDIT (source: drive_library_delete)
import { Command } from "commander"
import { driveLibraryDelete } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveLibraryDeleteCommand = new Command("rm")
  .description("Delete a drive library")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "drive_library_delete", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, (client) => driveLibraryDelete({
      client,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    }))
  })

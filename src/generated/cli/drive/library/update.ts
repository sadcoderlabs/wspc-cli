// AUTO-GENERATED — DO NOT EDIT (source: drive_library_update)
import { Command } from "commander"
import { driveLibraryUpdate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveLibraryUpdateCommand = new Command("update")
  .description("Update a drive library")
  .argument("<id>", "id")
  .option("--name <value>", "name")
  .option("--expected-version <value>", "expected_version")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "drive_library_update", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, (client) => driveLibraryUpdate({
      client,
      path: {
        id,
      },
      body: {
        name: opts.name,
        expected_version: opts.expectedVersion,
      },
    }))
  })

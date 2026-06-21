// AUTO-GENERATED — DO NOT EDIT (source: drive_library_create)
import { Command } from "commander"
import { driveLibraryCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveLibraryCreateCommand = new Command("add")
  .description("Create a drive library")
  .argument("<name>", "name")
  .action(async (name, opts) => {
    await runSdkCommand({ kind: "drive_library_create", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, (client) => driveLibraryCreate({
      client,
      body: {
        name,
      },
    }))
  })

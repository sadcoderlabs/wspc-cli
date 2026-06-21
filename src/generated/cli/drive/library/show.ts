// AUTO-GENERATED — DO NOT EDIT (source: drive_library_get)
import { Command } from "commander"
import { driveLibraryGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/sdk-result.js"

export const driveLibraryGetCommand = new Command("show")
  .description("Get a drive library")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "drive_library_get", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, (client) => driveLibraryGet({
      client,
      path: {
        id,
      },
    }))
  })

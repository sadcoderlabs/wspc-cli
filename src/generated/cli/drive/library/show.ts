// AUTO-GENERATED — DO NOT EDIT (source: drive_library_get)
import { Command } from "commander"
import { driveLibraryGet } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveLibraryGetCommand = new Command("show")
  .description("Get a drive library")
  .addHelpText("after", "\nFetch one active library by id. Cross-org and soft-deleted rows are hidden.\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: driveLibraryGet,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "drive_library_get", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} },
    })
  })

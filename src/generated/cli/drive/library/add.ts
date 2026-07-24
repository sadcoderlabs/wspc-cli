// AUTO-GENERATED — DO NOT EDIT (source: drive_library_create)
import { Command } from "commander"
import { driveLibraryCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"

export const driveLibraryCreateCommand = new Command("add")
  .description("Create a drive library")
  .addHelpText("after", "\nCreate an organization-scoped Drive / Library container.\n")
  .argument("<name>", "name")
  .action(async (name, opts) => {
    await runSdkCommand({
      operation: driveLibraryCreate,
      input: {
        body: {
          name,
        },
      },
      context: { kind: "drive_library_create", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} },
    })
  })

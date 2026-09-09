import { Command } from "commander"
import { driveFileDelete } from "../../../generated/sdk/index.js"
import { runSdkCommand } from "../run-sdk-command.js"
import { requireFileConfirmation } from "./api.js"

export function driveRemoveCommand(command = new Command("rm").argument("<id>", "library ID").argument("<path>", "original confirmed file path")): Command {
  const identity = command.options.find(option => option.long === "--entry-id")
  if (identity) identity.makeOptionMandatory()
  else command.requiredOption("--entry-id <id>", "original confirmed file entry ID")
  const version = command.options.find(option => option.long === "--expected-entry-version")
  if (version) version.makeOptionMandatory().argParser(Number)
  else command.requiredOption("--expected-entry-version <version>", "original confirmed positive safe-integer version", Number)
  return command
    .description("Delete only the original confirmed file entry")
    .addHelpText("after", "\nA conflict requires new confirmation. Do not fetch current values to retry an old intent. The backend must enforce these required fields before this protection is active.\n")
    .action(async (id: string, path: string, opts: { entryId: string; expectedEntryVersion: number }) => {
      requireFileConfirmation(opts.entryId, opts.expectedEntryVersion)
      await runSdkCommand({
        operation: driveFileDelete,
        input: { path: { id }, body: { entry_id: opts.entryId, path, expected_entry_version: opts.expectedEntryVersion } },
        context: { kind: "drive_file_delete", display: { shape: "object", dataPath: "entry", columns: ["path", "entry_version", "deleted_at"] } },
      })
    })
}

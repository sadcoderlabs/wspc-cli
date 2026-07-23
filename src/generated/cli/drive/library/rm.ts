// AUTO-GENERATED — DO NOT EDIT (source: drive_library_delete)
import { Command } from "commander"
import { driveLibraryDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const driveLibraryDeleteCommand = new Command("rm")
  .description("Delete a drive library")
  .addHelpText("after", "\nSoft-delete an empty library using optimistic version locking.\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveLibraryDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_library_delete", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, result.data)
  })

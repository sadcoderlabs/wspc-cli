// AUTO-GENERATED — DO NOT EDIT (source: drive_library_update)
import { Command } from "commander"
import { driveLibraryUpdate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveLibraryUpdateCommand = new Command("update")
  .description("Update a drive library")
  .addHelpText("after", "\nRename a library using optimistic version locking.\n")
  .argument("<id>", "id")
  .option("--name <value>", "name")
  .option("--expected-version <value>", "expected_version")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveLibraryUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        name: opts.name,
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
    render({ kind: "drive_library_update", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, result.data)
  })

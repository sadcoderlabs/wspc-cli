// AUTO-GENERATED — DO NOT EDIT (source: drive_file_delete)
import { Command } from "commander"
import { driveFileDelete } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveFileDeleteCommand = new Command("rm")
  .description("Delete a drive file")
  .argument("<id>", "id")
  .argument("<path>", "path")
  .option("--expected-entry-version <value>", "expected_entry_version")
  .action(async (id, path, opts) => {
    const client = await loadSdkClient()
    const result = await driveFileDelete({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        path,
        expected_entry_version: opts.expectedEntryVersion,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_file_delete", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","deleted_at"]} }, result.data)
  })

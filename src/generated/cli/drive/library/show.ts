// AUTO-GENERATED — DO NOT EDIT (source: drive_library_get)
import { Command } from "commander"
import { driveLibraryGet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveLibraryGetCommand = new Command("show")
  .description("Get a drive library")
  .addHelpText("after", "\nFetch one active library by id. Cross-org and soft-deleted rows are hidden.\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveLibraryGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_library_get", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, result.data)
  })

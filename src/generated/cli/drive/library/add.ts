// AUTO-GENERATED — DO NOT EDIT (source: drive_library_create)
import { Command } from "commander"
import { driveLibraryCreate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveLibraryCreateCommand = new Command("add")
  .description("Create a drive library")
  .argument("<name>", "name")
  .action(async (name, opts) => {
    const client = await loadSdkClient()
    const result = await driveLibraryCreate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        name,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_library_create", display: {"shape":"object","columns":["id","name","version","file_count","storage_bytes","updated_at"]} }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: drive_file_restore)
import { Command } from "commander"
import { driveFileRestore } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveFileRestoreCommand = new Command("restore")
  .description("Restore a drive file version")
  .argument("<id>", "id")
  .option("--path <value>", "path")
  .option("--version-id <value>", "version_id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveFileRestore({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        path: opts.path,
        version_id: opts.versionId,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_file_restore", display: {"shape":"object","dataPath":"entry","columns":["path","entry_version","updated_at"]} }, result.data)
  })

// AUTO-GENERATED — DO NOT EDIT (source: drive_manifest_get)
import { Command } from "commander"
import { driveManifestGet } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const driveManifestGetCommand = new Command("get")
  .description("Get a drive library manifest")
  .argument("<id>", "id")
  .option("--limit <value>", "limit")
  .option("--cursor <value>", "cursor")
  .option("--include-deleted <value>", "include_deleted")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await driveManifestGet({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      query: {
        limit: opts.limit,
        cursor: opts.cursor,
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "drive_manifest_get", display: {"shape":"list","dataPath":"entries","columns":["path","entry_version","size_bytes","updated_at"],"emptyMessage":"no drive files"} }, result.data)
  })

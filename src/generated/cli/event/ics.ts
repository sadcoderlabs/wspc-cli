// AUTO-GENERATED — DO NOT EDIT (source: event_ics_download)
import { Command } from "commander"
import { eventIcsDownload } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const eventIcsDownloadCommand = new Command("ics")
  .description("Download event as `.ics`")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await eventIcsDownload({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        filename: `${id}.ics`,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "event_ics_download", display: {"shape":"raw"} }, result.data)
  })

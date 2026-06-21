// AUTO-GENERATED — DO NOT EDIT (source: event_ics_download)
import { Command } from "commander"
import { eventIcsDownload } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const eventIcsDownloadCommand = new Command("ics")
  .description("Download event as `.ics`")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({ kind: "event_ics_download", display: {"shape":"raw"} }, (client) => eventIcsDownload({
      client,
      path: {
        filename: `${id}.ics`,
      },
    }))
  })

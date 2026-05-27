// AUTO-GENERATED — DO NOT EDIT (source: email_mark_read)
import { Command } from "commander"
import { emailMarkRead } from "../../sdk/index.js"
import { loadSdkClient } from "../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../handwritten/output/render.js"

export const emailMarkReadCommand = new Command("read")
  .description("Mark inbound emails as read")
  .option("--id <value>", "id", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])
  .action(async (opts) => {
    const idRaw = opts.id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    const client = await loadSdkClient()
    const result = await emailMarkRead({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      body: {
        ids: ids as string[],
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "email_mark_read", display: {"shape":"object","format":{}} }, result.data)
  })

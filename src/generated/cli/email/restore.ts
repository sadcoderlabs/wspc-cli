// AUTO-GENERATED — DO NOT EDIT (source: email_restore)
import { Command } from "commander"
import { emailRestore } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailRestoreCommand = new Command("restore")
  .description("Restore soft-deleted inbound emails")
  .addHelpText("after", "\n### Overview\nRestores a batch of soft-deleted inbound emails from the trash, making them reappear in standard inbox lists.\n\n### When to Use\n- Use this endpoint to recover email messages that were trashed by mistake.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Accepts 1 to 100 email IDs. Already-active IDs are silently ignored.\n\n### Troubleshooting\n- **401 Unauthorized**: Invalid token.\n- **400 Bad Request**: Malformed request or batch limit exceeded.\n")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({
      operation: emailRestore,
      input: {
        body: {
          ids: ids as string[],
        },
      },
      context: { kind: "email_restore", display: {"shape":"object","format":{}} },
    })
  })

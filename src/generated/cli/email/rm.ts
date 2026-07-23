// AUTO-GENERATED — DO NOT EDIT (source: email_delete)
import { Command } from "commander"
import { emailDelete } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailDeleteCommand = new Command("rm")
  .description("Soft-delete inbound emails")
  .addHelpText("after", "\n### Overview\nSoft-deletes a batch of inbound emails, moving them to the trash. Soft-deleted emails are immediately excluded from default inbox lists.\n\n### When to Use\n- Use this endpoint to trash one or more email messages from a user's inbox view.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Accepts 1 to 100 email IDs per call.\n- Deletion is fully reversible: soft-deleted rows persist in the database and can be undeleted using the restore endpoint.\n- **Data Cleanup**: Out-of-band background processes eventually purge associated raw MIME source payloads and attachment bytes from R2; deletion does not immediately free storage.\n\n### Troubleshooting\n- **401 Unauthorized**: Invalid Bearer token.\n- **400 Bad Request**: The request body is malformed or exceeds the maximum limit of 100 IDs.\n")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({
      operation: emailDelete,
      input: {
        body: {
          ids: ids as string[],
        },
      },
      context: { kind: "email_delete", display: {"shape":"object","format":{}} },
    })
  })

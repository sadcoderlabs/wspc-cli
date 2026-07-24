// AUTO-GENERATED — DO NOT EDIT (source: email_mark_read)
import { Command } from "commander"
import { emailMarkRead } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const emailMarkReadCommand = new Command("read")
  .description("Mark inbound emails as read")
  .addHelpText("after", "\n### Overview\nMarks a batch of inbound emails as read. This batch operation is fully idempotent.\n\n### When to Use\n- Use this endpoint when a user opens an email detail view or performs a bulk mark-read action in an inbox dashboard.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Accepts 1 to 100 email IDs in a single call.\n- **Idempotency**: Already-read IDs are silently processed without generating errors but do not count toward the returned `marked` value. Missing, unauthorized, or soft-deleted IDs will be logged in `not_found`.\n\n### Troubleshooting\n- **401 Unauthorized**: Invalid or missing Bearer token.\n- **400 Bad Request**: The request body is malformed or exceeds the maximum limit of 100 IDs.\n")
  .argument("<id...>", "id")
  .action(async (id, opts) => {
    const idRaw = id as string[]
    const ids = idRaw.length > 0 ? idRaw : undefined
    await runSdkCommand({
      operation: emailMarkRead,
      input: {
        body: {
          ids: ids as string[],
        },
      },
      context: { kind: "email_mark_read", display: {"shape":"object","format":{}} },
    })
  })

// AUTO-GENERATED — DO NOT EDIT (source: key_create)
import { Command } from "commander"
import { keyCreate } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const keyCreateCommand = new Command("create")
  .description("Create a new API key (full value returned once)")
  .addHelpText("after", "\n### Overview\nCreates and provisions a new long-lived API key for the authenticated user. The complete plaintext API key value (`api_key`) is returned **only once** in this endpoint's response and cannot be retrieved again.\n\n### When to Use\n- Use this endpoint when a user requests a new API key (e.g., `wspc keys create --label \"My Agent\"`) to isolate access for specific environments, applications, or developers.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- **Key Limit**: A user is limited to a maximum of 25 active API keys. Requesting a new key beyond this limit will result in a `KEY_LIMIT_EXCEEDED` error.\n- **Label Validation**: The `label` parameter must be between 1 and 60 characters after trimming whitespace. Failing to provide a valid label results in an `INVALID_LABEL` error.\n\n### Troubleshooting\n- **401 Unauthorized**: The Bearer token is missing or invalid.\n- **400 Bad Request**: The `label` parameter is empty, too long, or missing.\n- **400 Bad Request (Limit Exceeded)**: The user has hit the maximum limit of 25 active keys. An existing active key must be revoked before creating a new one.\n")
  .option("--label <value>", "Human-readable label for the new key (1–60 chars after trimming). Pick something that identifies where the key will live — agent name, machine, or environment — so you can recognise it later in `wspc keys list`.")
  .action(async (opts) => {
    await runSdkCommand({
      operation: keyCreate,
      input: {
        body: {
          label: opts.label,
        },
      },
      context: { kind: "key_create", display: {"shape":"object","fields":["id","label","api_key","created_at"],"format":{"id":"id-short","created_at":"relative-time"},"secretField":"api_key"} },
    })
  })

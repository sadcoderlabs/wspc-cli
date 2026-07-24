// AUTO-GENERATED — DO NOT EDIT (source: key_revoke)
import { Command } from "commander"
import { keyRevoke } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/run-sdk-command.js"

export const keyRevokeCommand = new Command("rm")
  .description("Soft-revoke an API key")
  .addHelpText("after", "\n### Overview\nPermanently revokes an active API key by its unique ID. Once revoked, the key becomes immediately invalid and will be rejected by all services.\n\n### When to Use\n- Use this endpoint to permanently deactivate an API key (e.g., when running `wspc keys revoke <id>`) due to token rotation, key leakage, or decommissioning of a machine/service.\n\n### Constraints\n- Requires a valid Bearer token in the `Authorization` header.\n- Revocation is permanent and cannot be undone.\n- A user can revoke any key they own, including the one they are currently using to make the call. If they revoke the current key, subsequent requests using that key will return `401 Unauthorized`.\n\n### Troubleshooting\n- **401 Unauthorized**: The active token is missing, expired, or invalid.\n- **404 Not Found**: The specified key ID does not exist, belongs to another user, or has already been revoked.\n- **400 Bad Request**: The `id` path parameter format is invalid. It must be in the format `key_<ULID>`.\n")
  .argument("<id>", "id")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: keyRevoke,
      input: {
        path: {
          id,
        },
      },
      context: { kind: "key_revoke", display: undefined },
    })
  })

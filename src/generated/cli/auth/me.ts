// AUTO-GENERATED — DO NOT EDIT (source: auth_me)
import { Command } from "commander"
import { authMe } from "../../sdk/index.js"
import { runSdkCommand } from "../../../handwritten/commands/sdk-result.js"

export const authMeCommand = new Command("me")
  .description("Fetch the user identified by the bearer token")
  .action(async (opts) => {
    await runSdkCommand({ kind: "auth_me", display: {"shape":"object","fields":["user_id","email","display_name","api_key_id"],"format":{"user_id":"id-short","api_key_id":"id-short"}} }, (client) => authMe({
      client,
    }))
  })

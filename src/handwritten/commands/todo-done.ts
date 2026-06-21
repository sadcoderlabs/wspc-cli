import { Command } from "commander"
import { todoUpdate } from "../../generated/sdk/index.js"
import type { XCliDisplay } from "../output/types.js"
import { runSdkCommand } from "./sdk-result.js"

/**
 * Mirrors the `display` block on the spec's `todo_update` operation. We
 * pin it here rather than reaching into the auto-generated `todo update`
 * command file because the generated file's exact identifier layout is an
 * implementation detail of the codegen. If the spec adds fields, this
 * object lags by one PR — same trade-off as the generated commands take.
 */
const TODO_UPDATE_DISPLAY: XCliDisplay = {
  shape: "object",
  format: {
    id: "id-short",
    user_id: "id-short",
    project_id: "id-short",
    parent_id: "id-short",
    type_id: "id-short",
    title: "truncate",
    description: "truncate",
    status: "status-badge",
    due_at: "relative-time",
    created_at: "relative-time",
    updated_at: "relative-time",
    deleted_at: "relative-time",
  },
}

export const todoDoneCommand = new Command("done")
  .description("Mark a todo done (sugar for `update <id> --status done`)")
  .argument("<id>", "Todo id")
  .action(async (id: string) => {
    await runSdkCommand({ kind: "todo_update", display: TODO_UPDATE_DISPLAY }, (client) =>
      todoUpdate({
        client,
        path: { id },
        body: { status: "done" } as never,
      }),
    )
  })

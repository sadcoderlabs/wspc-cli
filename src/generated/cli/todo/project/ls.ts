// AUTO-GENERATED — DO NOT EDIT (source: project_list)
import { Command } from "commander"
import { projectList } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"

export const projectListCommand = new Command("ls")
  .description("List projects")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nList all project workspaces available to the authenticated organization or user.\n\n### 🔍 When to Use\n* Use this to populate project switcher dropdown menus, load side navigation views, or find valid project IDs before listing other scoped resources.\n\n### 💡 Key Features & Constraints\n* **Archived Visibility**: Soft-deleted projects are omitted from default listings. Pass `include_deleted=true` to include them for auditing or recovery dashboards.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`AUTH_REQUIRED` (HTTP 401)**: Thrown if the caller is not authenticated.\n\nExamples:\n  $ wspc todo project ls\n")
  .option("--include-deleted <value>", "Set to `true` to include soft-deleted projects in the response.")
  .action(async (opts) => {
    const client = await loadSdkClient()
    const result = await projectList({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      query: {
        include_deleted: opts.includeDeleted,
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "project_list", display: {"shape":"list","columns":["id","name","default_todo_type_id"],"format":{"id":"id-short","name":"truncate","default_todo_type_id":"id-short"},"emptyMessage":"no projects"} }, result.data)
  })

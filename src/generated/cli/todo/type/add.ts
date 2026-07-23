// AUTO-GENERATED — DO NOT EDIT (source: todo_type_create)
import { Command } from "commander"
import { todoTypeCreate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseJsonField } from "../../../../handwritten/utils/parse-json-field.js"

export const todoTypeCreateCommand = new Command("add")
  .description("Create a todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nCreate a new custom todo type. This allows you to define specialized category schemas (e.g. \"Bug Report\") and configure custom field constraints.\n\n### 🔍 When to Use\n* Use this to set up customized task behaviors (e.g. tracking choices, additional metadata, or enforcing hidden fields) tailored to a project.\n\n### 💡 Key Features & Constraints\n* **Automatic Seeding**: The first project initialization will lazily seed a `Default Project` and a `Default` todo type if they do not already exist.\n* **Metadata Schema**: Custom field keys mapped here are evaluated during task creation/update.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`VALIDATION_ERROR` (HTTP 400)**: Thrown if required fields are missing or schema constraints are violated.\n\nExamples:\n  $ wspc todo type add \"Bug Report\"\n  $ wspc todo type add \"Bug Report\" --project prj_xxx\n  $ wspc todo type add \"Sprint Task\" --custom-fields '[{\"key\":\"story_points\",\"label\":\"Story Points\",\"type\":\"string\"}]'\n")
  .argument("<label>", "label")
  .option("-p, --project <value>", "Project this type belongs to. Required. It must be an active project in the caller's organization.")
  .option("--hide-core-fields <value>", "hide_core_fields")
  .option("--custom-fields <value>", "custom_fields")
  .action(async (label, opts) => {
    await runSdkCommand({
      operation: todoTypeCreate,
      input: {
        body: {
          label,
          project_id: opts.project,
          hide_core_fields: parseJsonField(opts.hideCoreFields, "hide-core-fields"),
          custom_fields: parseJsonField(opts.customFields, "custom-fields"),
        },
      },
      context: { kind: "todo_type_create", display: undefined },
    })
  })

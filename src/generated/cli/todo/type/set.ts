// AUTO-GENERATED — DO NOT EDIT (source: todo_type_update)
import { Command } from "commander"
import { todoTypeUpdate } from "../../../sdk/index.js"
import { loadSdkClient } from "../../../../handwritten/auth/load-sdk-client.js"
import { render } from "../../../../handwritten/output/render.js"
import { parseJsonField } from "../../../../handwritten/utils/parse-json-field.js"

export const todoTypeUpdateCommand = new Command("set")
  .description("Update a todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nUpdate a custom todo type's label, core field overrides, or custom field schema definitions.\n\n### 🔍 When to Use\n* Use this to rename a task category category, hide native todo attributes, or adjust custom data schemas.\n\n### 💡 Key Features & Constraints\n* **Type Modification Constraints**: Changing the data `type` of an existing custom field key (e.g. converting a string field to a boolean field) is strictly rejected with `CANNOT_CHANGE_FIELD_TYPE`. To migrate, remove the key and re-add it under a brand new name.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`CANNOT_CHANGE_FIELD_TYPE` (HTTP 422)**: Thrown if you attempt to modify the declared data type of an existing custom field key.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target ID does not exist.\n\nExamples:\n  $ wspc todo type set typ_xxx --label \"Feature Request\"\n  $ wspc todo type set typ_xxx --custom-fields '[{\"key\":\"severity\",\"label\":\"Severity\",\"type\":\"string\"}]'\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version")
  .option("--label <value>", "label")
  .option("--hide-core-fields <value>", "hide_core_fields")
  .option("--custom-fields <value>", "custom_fields")
  .action(async (id, opts) => {
    const client = await loadSdkClient()
    const result = await todoTypeUpdate({
      client: (client as unknown as { _rawClient: unknown })._rawClient as never,
      path: {
        id,
      },
      body: {
        expected_version: opts.expectedVersion,
        label: opts.label,
        hide_core_fields: parseJsonField(opts.hideCoreFields, "hide-core-fields"),
        custom_fields: parseJsonField(opts.customFields, "custom-fields"),
      },
    })
    if (result.error || !result.response?.ok) {
      process.stderr.write(
        `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
      )
      process.exitCode = 1
      return
    }
    render({ kind: "todo_type_update", display: undefined }, result.data)
  })

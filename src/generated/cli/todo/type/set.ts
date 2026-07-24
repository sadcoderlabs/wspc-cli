// AUTO-GENERATED — DO NOT EDIT (source: todo_type_update)
import { Command } from "commander"
import { todoTypeUpdate } from "../../../sdk/index.js"
import { runSdkCommand } from "../../../../handwritten/commands/run-sdk-command.js"
import { parseJsonField } from "../../../../handwritten/utils/parse-json-field.js"
import { parseIntegerField } from "../../../../handwritten/utils/parse-scalar-field.js"

export const todoTypeUpdateCommand = new Command("set")
  .description("Update a todo type")
  .addHelpText("after", "\n### 🎯 Overview & Purpose\nUpdate a custom todo type's label, core field overrides, or custom field schema definitions.\n\n### 🔍 When to Use\n* Use this to rename a task category category, hide native todo attributes, or adjust custom data schemas.\n\n### 💡 Key Features & Constraints\n* **Type Modification Constraints**: Changing the data `type` of an existing custom field key (e.g. converting a string field to a boolean field) is strictly rejected with `CANNOT_CHANGE_FIELD_TYPE`. To migrate, remove the key and re-add it under a brand new name.\n\n### ⚠️ Common Errors & Troubleshooting\n* **`CANNOT_CHANGE_FIELD_TYPE` (HTTP 422)**: Thrown if you attempt to modify the declared data type of an existing custom field key.\n* **`NOT_FOUND` (HTTP 404)**: Thrown if the target ID does not exist.\n\nExamples:\n  $ wspc todo type set typ_xxx --label \"Feature Request\"\n  $ wspc todo type set typ_xxx --custom-fields '[{\"key\":\"severity\",\"label\":\"Severity\",\"type\":\"string\"}]'\n")
  .argument("<id>", "id")
  .option("--expected-version <value>", "expected_version", (value: string) => parseIntegerField(value, "expected-version"))
  .option("--label <value>", "label")
  .option("--hide-core-fields <value>", "hide_core_fields")
  .option("--custom-fields <value>", "custom_fields")
  .action(async (id, opts) => {
    await runSdkCommand({
      operation: todoTypeUpdate,
      input: {
        path: {
          id,
        },
        body: {
          expected_version: opts.expectedVersion,
          label: opts.label,
          hide_core_fields: parseJsonField(opts.hideCoreFields, "hide-core-fields"),
          custom_fields: parseJsonField(opts.customFields, "custom-fields"),
        },
      },
      context: { kind: "todo_type_update", display: undefined },
    })
  })

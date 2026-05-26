// AUTO-GENERATED — DO NOT EDIT
import { Command } from "commander"
import { projectCreateCommand } from "./todo/project/add.js"
import { projectListCommand } from "./todo/project/ls.js"
import { recurrenceRuleListCommand } from "./todo/rule/ls.js"
import { todoCreateCommand } from "./todo/add.js"
import { todoListCommand } from "./todo/ls.js"
import { todoTypeListCommand } from "./todo/type/ls.js"
import { todoDeleteCommand } from "./todo/rm.js"
import { todoGetCommand } from "./todo/show.js"
import { todoUpdateCommand } from "./todo/update.js"

export function registerGeneratedCommands(root: Command): void {
  const root_todo = root.command("todo")
  const root_todo_project = root_todo.command("project")
  root_todo_project.addCommand(projectCreateCommand)
  root_todo_project.addCommand(projectListCommand)
  const root_todo_rule = root_todo.command("rule")
  root_todo_rule.addCommand(recurrenceRuleListCommand)
  root_todo.addCommand(todoCreateCommand)
  root_todo.addCommand(todoListCommand)
  const root_todo_type = root_todo.command("type")
  root_todo_type.addCommand(todoTypeListCommand)
  root_todo.addCommand(todoDeleteCommand)
  root_todo.addCommand(todoGetCommand)
  root_todo.addCommand(todoUpdateCommand)
}

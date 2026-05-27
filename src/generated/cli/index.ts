// AUTO-GENERATED — DO NOT EDIT
import { Command } from "commander"
import { keyCreateCommand } from "./keys/create.js"
import { keyListCommand } from "./keys/ls.js"
import { orgGetCommand } from "./org/show.js"
import { authMeCommand } from "./auth/me.js"
import { orgMembersListCommand } from "./org/members.js"
import { keyRevokeCommand } from "./keys/rm.js"
import { eventCreateCommand } from "./event/add.js"
import { eventListCommand } from "./event/ls.js"
import { eventDeleteCommand } from "./event/rm.js"
import { eventGetCommand } from "./event/show.js"
import { eventUpdateCommand } from "./event/set.js"
import { eventIcsDownloadCommand } from "./event/ics.js"
import { emailAliasCreateCommand } from "./alias/add.js"
import { emailAliasListCommand } from "./alias/ls.js"
import { emailAliasDeleteCommand } from "./alias/rm.js"
import { emailDeleteCommand } from "./email/rm.js"
import { emailGetCommand } from "./email/show.js"
import { emailListCommand } from "./email/ls.js"
import { emailMarkReadCommand } from "./email/read.js"
import { emailMarkUnreadCommand } from "./email/unread.js"
import { pushConfigDeleteCommand } from "./push/config/rm.js"
import { pushConfigSetCommand } from "./push/config/set.js"
import { pushConfigGetCommand } from "./push/config/show.js"
import { pushTestCommand } from "./push/test.js"
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
  const root_keys = root.command("keys").description("keys commands")
  root_keys.addCommand(keyCreateCommand)
  root_keys.addCommand(keyListCommand)
  root_keys.addCommand(keyRevokeCommand)
  const root_org = root.command("org").description("org commands")
  root_org.addCommand(orgGetCommand)
  root_org.addCommand(orgMembersListCommand)
  const root_auth = root.command("auth").description("auth commands")
  root_auth.addCommand(authMeCommand)
  const root_event = root.command("event").description("event commands")
  root_event.addCommand(eventCreateCommand)
  root_event.addCommand(eventListCommand)
  root_event.addCommand(eventDeleteCommand)
  root_event.addCommand(eventGetCommand)
  root_event.addCommand(eventUpdateCommand)
  root_event.addCommand(eventIcsDownloadCommand)
  const root_alias = root.command("alias").description("alias commands")
  root_alias.addCommand(emailAliasCreateCommand)
  root_alias.addCommand(emailAliasListCommand)
  root_alias.addCommand(emailAliasDeleteCommand)
  const root_email = root.command("email").description("email commands")
  root_email.addCommand(emailDeleteCommand)
  root_email.addCommand(emailGetCommand)
  root_email.addCommand(emailListCommand)
  root_email.addCommand(emailMarkReadCommand)
  root_email.addCommand(emailMarkUnreadCommand)
  const root_push = root.command("push").description("push commands")
  const root_push_config = root_push.command("config").description("config commands")
  root_push_config.addCommand(pushConfigDeleteCommand)
  root_push_config.addCommand(pushConfigSetCommand)
  root_push_config.addCommand(pushConfigGetCommand)
  root_push.addCommand(pushTestCommand)
  const root_todo = root.command("todo").description("todo commands")
  const root_todo_project = root_todo.command("project").description("project commands")
  root_todo_project.addCommand(projectCreateCommand)
  root_todo_project.addCommand(projectListCommand)
  const root_todo_rule = root_todo.command("rule").description("rule commands")
  root_todo_rule.addCommand(recurrenceRuleListCommand)
  root_todo.addCommand(todoCreateCommand)
  root_todo.addCommand(todoListCommand)
  const root_todo_type = root_todo.command("type").description("type commands")
  root_todo_type.addCommand(todoTypeListCommand)
  root_todo.addCommand(todoDeleteCommand)
  root_todo.addCommand(todoGetCommand)
  root_todo.addCommand(todoUpdateCommand)
}

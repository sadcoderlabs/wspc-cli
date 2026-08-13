// AUTO-GENERATED — DO NOT EDIT
import { Command } from "commander"
import { inviteAcceptCommand } from "./invite/accept.js"
import { keyCreateCommand } from "./keys/create.js"
import { keyListCommand } from "./keys/ls.js"
import { orgInviteCreateCommand } from "./org/invite.js"
import { orgInvitesListCommand } from "./org/invites.js"
import { orgGetCommand } from "./org/show.js"
import { orgUpdateCommand } from "./org/rename.js"
import { inviteGetCommand } from "./invite/show.js"
import { authMeCommand } from "./auth/me.js"
import { invitesListCommand } from "./invites.js"
import { orgMembersListCommand } from "./org/members.js"
import { inviteRejectCommand } from "./invite/reject.js"
import { keyRevokeCommand } from "./keys/rm.js"
import { keyUpdateCommand } from "./keys/edit.js"
import { orgInviteRevokeCommand } from "./org/invite/revoke.js"
import { eventCreateCommand } from "./event/add.js"
import { eventListCommand } from "./event/ls.js"
import { eventDeleteCommand } from "./event/rm.js"
import { eventGetCommand } from "./event/show.js"
import { eventUpdateCommand } from "./event/set.js"
import { eventIcsDownloadCommand } from "./event/ics.js"
import { eventAgendaCommand } from "./event/agenda.js"
import { eventOccurrencesCommand } from "./event/occurrences.js"
import { eventRestoreCommand } from "./event/restore.js"
import { driveLibraryCreateCommand } from "./drive/library/add.js"
import { driveLibraryListCommand } from "./drive/library/ls.js"
import { driveFileDeleteCommand } from "./drive/file/rm.js"
import { driveLibraryDeleteCommand } from "./drive/library/rm.js"
import { driveLibraryGetCommand } from "./drive/library/show.js"
import { driveLibraryUpdateCommand } from "./drive/library/update.js"
import { driveFileHistoryCommand } from "./drive/file/history.js"
import { driveManifestGetCommand } from "./drive/manifest/get.js"
import { driveFileRestoreCommand } from "./drive/file/restore.js"
import { driveSearchCommand } from "./drive/search.js"
import { emailAliasCreateCommand } from "./alias/add.js"
import { emailAliasListCommand } from "./alias/ls.js"
import { emailDomainCreateCommand } from "./domain/add.js"
import { emailDomainListCommand } from "./domain/ls.js"
import { emailAliasDeleteCommand } from "./alias/rm.js"
import { emailDeleteCommand } from "./email/rm.js"
import { emailDomainDeleteCommand } from "./domain/rm.js"
import { emailDomainGetCommand } from "./domain/show.js"
import { emailGetCommand } from "./email/show.js"
import { emailListCommand } from "./email/ls.js"
import { emailMarkReadCommand } from "./email/read.js"
import { emailMarkUnreadCommand } from "./email/unread.js"
import { emailAliasRestoreCommand } from "./alias/restore.js"
import { emailRestoreCommand } from "./email/restore.js"
import { emailDomainVerifyCommand } from "./domain/verify.js"
import { pushConfigDeleteCommand } from "./push/config/rm.js"
import { pushConfigSetCommand } from "./push/config/set.js"
import { pushConfigGetCommand } from "./push/config/show.js"
import { pushTestCommand } from "./push/test.js"
import { todoCommentCreateCommand } from "./todo/comment/add.js"
import { todoCommentListCommand } from "./todo/comment/ls.js"
import { projectCreateCommand } from "./todo/project/add.js"
import { projectListCommand } from "./todo/project/ls.js"
import { recurrenceRuleCreateCommand } from "./todo/rule/add.js"
import { recurrenceRuleListCommand } from "./todo/rule/ls.js"
import { todoCreateCommand } from "./todo/add.js"
import { todoListCommand } from "./todo/ls.js"
import { todoTypeCreateCommand } from "./todo/type/add.js"
import { todoTypeListCommand } from "./todo/type/ls.js"
import { todoCommentDeleteCommand } from "./todo/comment/rm.js"
import { todoCommentUpdateCommand } from "./todo/comment/edit.js"
import { projectDeleteCommand } from "./todo/project/rm.js"
import { recurrenceRuleDeleteCommand } from "./todo/rule/rm.js"
import { recurrenceRuleGetCommand } from "./todo/rule/show.js"
import { todoDeleteCommand } from "./todo/rm.js"
import { todoGetCommand } from "./todo/show.js"
import { todoUpdateCommand } from "./todo/update.js"
import { todoTypeDeleteCommand } from "./todo/type/rm.js"
import { todoTypeUpdateCommand } from "./todo/type/set.js"
import { todoRestoreCommand } from "./todo/restore.js"
import { todoTypeRestoreCommand } from "./todo/type/restore.js"

export function registerGeneratedCommands(root: Command): void {
  const root_invite = root.command("invite").description("invite commands")
  root_invite.addCommand(inviteAcceptCommand)
  root_invite.addCommand(inviteGetCommand)
  root_invite.addCommand(inviteRejectCommand)
  const root_keys = root.command("keys").description("keys commands")
  root_keys.addCommand(keyCreateCommand)
  root_keys.addCommand(keyListCommand)
  root_keys.addCommand(keyRevokeCommand)
  root_keys.addCommand(keyUpdateCommand)
  const root_org = root.command("org").description("org commands")
  const root_org_invite = root_org.command("invite").description("invite commands")
  root_org_invite.addCommand(orgInviteCreateCommand)
  root_org_invite.addCommand(orgInviteRevokeCommand)
  root_org.addCommand(orgInvitesListCommand)
  root_org.addCommand(orgGetCommand)
  root_org.addCommand(orgUpdateCommand)
  root_org.addCommand(orgMembersListCommand)
  const root_auth = root.command("auth").description("auth commands")
  root_auth.addCommand(authMeCommand)
  root.addCommand(invitesListCommand)
  const root_event = root.command("event").description("event commands")
  root_event.addCommand(eventCreateCommand)
  root_event.addCommand(eventListCommand)
  root_event.addCommand(eventDeleteCommand)
  root_event.addCommand(eventGetCommand)
  root_event.addCommand(eventUpdateCommand)
  root_event.addCommand(eventIcsDownloadCommand)
  root_event.addCommand(eventAgendaCommand)
  root_event.addCommand(eventOccurrencesCommand)
  root_event.addCommand(eventRestoreCommand)
  const root_drive = root.command("drive").description("drive commands")
  const root_drive_library = root_drive.command("library").description("library commands")
  root_drive_library.addCommand(driveLibraryCreateCommand)
  root_drive_library.addCommand(driveLibraryListCommand)
  root_drive_library.addCommand(driveLibraryDeleteCommand)
  root_drive_library.addCommand(driveLibraryGetCommand)
  root_drive_library.addCommand(driveLibraryUpdateCommand)
  const root_drive_file = root_drive.command("file").description("file commands")
  root_drive_file.addCommand(driveFileDeleteCommand)
  root_drive_file.addCommand(driveFileHistoryCommand)
  root_drive_file.addCommand(driveFileRestoreCommand)
  const root_drive_manifest = root_drive.command("manifest").description("manifest commands")
  root_drive_manifest.addCommand(driveManifestGetCommand)
  root_drive.addCommand(driveSearchCommand)
  const root_alias = root.command("alias").description("alias commands")
  root_alias.addCommand(emailAliasCreateCommand)
  root_alias.addCommand(emailAliasListCommand)
  root_alias.addCommand(emailAliasDeleteCommand)
  root_alias.addCommand(emailAliasRestoreCommand)
  const root_domain = root.command("domain").description("domain commands")
  root_domain.addCommand(emailDomainCreateCommand)
  root_domain.addCommand(emailDomainListCommand)
  root_domain.addCommand(emailDomainDeleteCommand)
  root_domain.addCommand(emailDomainGetCommand)
  root_domain.addCommand(emailDomainVerifyCommand)
  const root_email = root.command("email").description("email commands")
  root_email.addCommand(emailDeleteCommand)
  root_email.addCommand(emailGetCommand)
  root_email.addCommand(emailListCommand)
  root_email.addCommand(emailMarkReadCommand)
  root_email.addCommand(emailMarkUnreadCommand)
  root_email.addCommand(emailRestoreCommand)
  const root_push = root.command("push").description("push commands")
  const root_push_config = root_push.command("config").description("config commands")
  root_push_config.addCommand(pushConfigDeleteCommand)
  root_push_config.addCommand(pushConfigSetCommand)
  root_push_config.addCommand(pushConfigGetCommand)
  root_push.addCommand(pushTestCommand)
  const root_todo = root.command("todo").description("todo commands")
  const root_todo_comment = root_todo.command("comment").description("comment commands")
  root_todo_comment.addCommand(todoCommentCreateCommand)
  root_todo_comment.addCommand(todoCommentListCommand)
  root_todo_comment.addCommand(todoCommentDeleteCommand)
  root_todo_comment.addCommand(todoCommentUpdateCommand)
  const root_todo_project = root_todo.command("project").description("project commands")
  root_todo_project.addCommand(projectCreateCommand)
  root_todo_project.addCommand(projectListCommand)
  root_todo_project.addCommand(projectDeleteCommand)
  const root_todo_rule = root_todo.command("rule").description("rule commands")
  root_todo_rule.addCommand(recurrenceRuleCreateCommand)
  root_todo_rule.addCommand(recurrenceRuleListCommand)
  root_todo_rule.addCommand(recurrenceRuleDeleteCommand)
  root_todo_rule.addCommand(recurrenceRuleGetCommand)
  root_todo.addCommand(todoCreateCommand)
  root_todo.addCommand(todoListCommand)
  const root_todo_type = root_todo.command("type").description("type commands")
  root_todo_type.addCommand(todoTypeCreateCommand)
  root_todo_type.addCommand(todoTypeListCommand)
  root_todo_type.addCommand(todoTypeDeleteCommand)
  root_todo_type.addCommand(todoTypeUpdateCommand)
  root_todo_type.addCommand(todoTypeRestoreCommand)
  root_todo.addCommand(todoDeleteCommand)
  root_todo.addCommand(todoGetCommand)
  root_todo.addCommand(todoUpdateCommand)
  root_todo.addCommand(todoRestoreCommand)
}

import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, posix as pathPosix } from "node:path"
import type { UploadDriveFileResponse } from "../../../generated/sdk/index.js"
import { driveConflictTimestamp, driveIsoTimestamp, type DriveClock } from "./clock.js"
import type { DriveDebugLogger } from "./debug-log.js"
import type { DriveAction } from "./decision.js"
import {
  assertLocalAbsentBeforeRemoteDelete,
  assertLocalSafeForDownload,
  assertLocalStillScanned,
  downloadRemote,
  installNoOverwrite,
  localFileExists,
  readStableUploadBody,
  removeLocalIfStillBase,
  writeMergedLocalFile,
} from "./local-mutations.js"
import { classifyMergeText, conflictCopyPath, mergeText3 } from "./merge.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"
import {
  isDriveAuthFailure,
  isRetryableDriveFailure,
  type DrivePathErrorSummary,
} from "./retry.js"
import {
  writeDriveState,
  type DriveConflict,
  type DriveState,
  type DriveStateEntry,
} from "./state.js"
import type {
  DrivePathActionApi,
  DriveSyncSummary,
  RemoteEntry,
} from "./sync-contracts.js"

export interface DrivePathExecutionInput {
  root: string
  state: DriveState
  api: DrivePathActionApi
  path: string
  action: DriveAction
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  summary: DriveSyncSummary
  clock: DriveClock
  debug: DriveDebugLogger
}

export interface DrivePathExecutionResult {
  state: DriveState
  stop: boolean
}

export async function executeDrivePathAction(
  args: DrivePathExecutionInput,
): Promise<DrivePathExecutionResult> {
  const { root, state, api, path, action, remote, local, summary, clock, debug } = args
  summary.paths.push({ path, action: action.type })
  let durableStateRequired = false

  try {
    if (action.type === "upload_create" || action.type === "upload_update") {
      const localPath = resolveInsideRoot(root, path)
      const { body, digest: uploadDigest } = await readStableUploadBody(localPath, local)
      const uploaded = await api.uploadFile(state.library_id, path, body, uploadDigest, action.expectedEntryVersion)
      durableStateRequired = true
      const nextState = cloneDriveState(state)
      nextState.entries[path] = stateEntryFromRemote(uploaded.entry, uploadDigest, clock)
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.uploaded += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "download") {
      if (!remote) throw new Error("remote entry missing for download")
      await assertLocalSafeForDownload(root, path, state.entries[path])
      const digest = await downloadRemote(root, state.library_id, path, api, remote.content_sha256, state.entries[path], () => {
        durableStateRequired = true
      })
      const nextState = cloneDriveState(state)
      nextState.entries[path] = stateEntryFromRemote(remote, digest, clock)
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.downloaded += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "delete_remote") {
      await assertLocalAbsentBeforeRemoteDelete(root, path)
      await api.deleteFile(state.library_id, path, action.expectedEntryVersion)
      durableStateRequired = true
      await assertLocalAbsentBeforeRemoteDelete(root, path)
      const nextState = cloneDriveState(state)
      delete nextState.entries[path]
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.deleted += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "delete_local") {
      await removeLocalIfStillBase(root, path, state.entries[path], () => {
        durableStateRequired = true
      })
      const nextState = cloneDriveState(state)
      delete nextState.entries[path]
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.deleted += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "state_only") {
      if (!remote) throw new Error("remote entry missing for state update")
      const nextState = cloneDriveState(state)
      nextState.entries[path] = stateEntryFromRemote(remote, local?.sha256 ?? remote.content_sha256, clock)
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.unchanged += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "remove_state") {
      const nextState = cloneDriveState(state)
      delete nextState.entries[path]
      delete nextState.conflicts[path]
      await writeDriveState(root, nextState, clock)
      summary.unchanged += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "conflict") {
      if (action.reason === "local_and_remote_changed") {
        try {
          const mergedState = await tryResolveConflict({
            root,
            state,
            api,
            path,
            remote,
            local,
            clock,
            onLocalMutation: () => {
              durableStateRequired = true
            },
          })
          if (mergedState) {
            summary.merged += 1
            summary.paths[summary.paths.length - 1] = { path, action: "merged" }
            return { state: mergedState, stop: false }
          }
        } catch (error) {
          if (!isLocalChangedDuringMerge(error)) {
            throw error
          }
          const nextState = await recordTypedConflict(root, state, path, action.reason, remote, clock, {
            type: "edit_edit",
            strategy: "record_only",
            reason: "local_changed_during_merge",
          })
          summary.conflicts += 1
          return { state: nextState, stop: false }
        }
        const resolved = await resolveConflictWithLocalAsMain({ root, state, api, path, remote, local, clock })
        if (resolved) {
          recordResolvedConflict(summary, debug, path, resolved.copyPath, action.reason, "edit_edit")
          return { state: resolved.state, stop: false }
        }
      }
      if (action.reason === "local_and_remote_without_base") {
        const resolved = await resolveConflictWithLocalAsMain({ root, state, api, path, remote, local, clock })
        if (resolved) {
          recordResolvedConflict(summary, debug, path, resolved.copyPath, action.reason, "create_create")
          return { state: resolved.state, stop: false }
        }
      }
      if (action.reason === "local_changed_remote_deleted") {
        const nextState = await recordTypedConflict(root, state, path, action.reason, remote, clock, {
          type: "edit_delete",
          strategy: "record_only",
        })
        summary.conflicts += 1
        return { state: nextState, stop: false }
      }
      if (action.reason === "remote_changed_before_delete") {
        const conflictCopyState = await recordRemoteConflictCopy({
          root,
          state,
          api,
          path,
          reason: action.reason,
          type: "delete_edit",
          remote,
          clock,
        })
        if (conflictCopyState) {
          summary.conflicts += 1
          return { state: conflictCopyState, stop: false }
        }
      }
      const nextState = await recordConflict(root, state, path, action.reason, remote, clock)
      summary.conflicts += 1
      return { state: nextState, stop: false }
    }

    summary.unchanged += 1
  } catch (error) {
    if (isRetryableDriveFailure(error) || isDriveAuthFailure(error)) throw error
    if (isVersionConflict(error)) {
      try {
        const nextState = await recordConflict(root, state, path, "VERSION_CONFLICT", remote, clock)
        summary.conflicts += 1
        summary.paths[summary.paths.length - 1] = { path, action: "conflict" }
        return { state: nextState, stop: false }
      } catch (writeError) {
        await recordDrivePathError(summary, undefined, path, writeError, { debug, op: "process" })
        return { state, stop: durableStateRequired }
      }
    }
    await recordDrivePathError(summary, undefined, path, error, { debug, op: "process" })
    return { state, stop: durableStateRequired }
  }
  return { state, stop: false }
}

async function tryResolveConflict(args: {
  root: string
  state: DriveState
  api: DrivePathActionApi
  path: string
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  clock: DriveClock
  onLocalMutation: () => void
}): Promise<DriveState | undefined> {
  const { root, state, api, path, remote, local, clock, onLocalMutation } = args
  const entry = state.entries[path]
  const baseVersionId = entry?.current_version_id
  const remoteVersionId = remote?.current_version_id
  if (!entry || !remote || !local || baseVersionId === undefined || remoteVersionId === undefined) {
    return undefined
  }

  const localPath = resolveInsideRoot(root, path)
  let baseBytes: Uint8Array
  let remoteBytes: Uint8Array
  try {
    const [downloadedBaseBytes, downloadedRemoteBytes] = await Promise.all([
      downloadBytes(api, state.library_id, path, baseVersionId),
      downloadBytes(api, state.library_id, path, remoteVersionId),
    ])
    baseBytes = downloadedBaseBytes
    remoteBytes = downloadedRemoteBytes
  } catch (error) {
    if (isExpectedVersionDownloadMissing(error)) {
      return undefined
    }
    throw error
  }
  const localBytes = await readFile(localPath)
  const baseText = classifyMergeText(path, baseBytes, undefined)
  const localText = classifyMergeText(path, localBytes, undefined)
  const remoteText = classifyMergeText(path, remoteBytes, undefined)
  if (!baseText.mergeable || !localText.mergeable || !remoteText.mergeable) {
    return undefined
  }

  const merged = mergeText3(baseText.text, localText.text, remoteText.text)
  if (!merged.clean) {
    return undefined
  }

  await assertLocalStillScanned(localPath, local)
  const mergedBytes = new TextEncoder().encode(merged.text)
  const mergedDigest = createHash("sha256").update(mergedBytes).digest("hex")
  const install = await writeMergedLocalFile(root, path, mergedBytes, mergedDigest, local, onLocalMutation)
  let uploaded: UploadDriveFileResponse
  try {
    uploaded = await api.uploadFile(state.library_id, path, mergedBytes, mergedDigest, remote.entry_version)
  } catch (error) {
    await install.restore()
    throw error
  }
  await install.finalize()

  const nextState = cloneDriveState(state)
  nextState.entries[path] = stateEntryFromRemote(uploaded.entry, mergedDigest, clock)
  delete nextState.conflicts[path]
  await writeDriveState(root, nextState, clock)
  return nextState
}

async function downloadBytes(
  api: DrivePathActionApi,
  libraryId: string,
  path: string,
  versionId: string,
): Promise<Uint8Array> {
  const response = await api.downloadFile(libraryId, path, versionId)
  return new Uint8Array(await response.arrayBuffer())
}

function recordResolvedConflict(
  summary: DriveSyncSummary,
  debug: DriveDebugLogger,
  path: string,
  copyPath: string,
  reason: string,
  type: NonNullable<DriveConflict["type"]>,
): void {
  summary.conflicts += 1
  summary.conflict_paths.push(copyPath)
  const lastPath = summary.paths.at(-1)
  if (lastPath?.path === path) {
    lastPath.conflict_paths = [copyPath]
  }
  debug.log("conflict", { path, reason, type, strategy: "conflict_copy", conflict_paths: [copyPath] })
}

// Resolves an edit/edit or create/create conflict in one pass: the remote
// version is preserved as a conflict copy, the local content is uploaded as
// the new main version, and the base state advances so the next sync does not
// re-detect the same conflict.
async function resolveConflictWithLocalAsMain(args: {
  root: string
  state: DriveState
  api: DrivePathActionApi
  path: string
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  clock: DriveClock
}): Promise<{ state: DriveState; copyPath: string } | undefined> {
  const { root, state, api, path, remote, local, clock } = args
  const remoteVersionId = remote?.current_version_id
  if (!remote || remoteVersionId === undefined || !local) {
    return undefined
  }

  const previous = state.conflicts[path]
  let copyPath: string
  if (previous !== undefined && (await canReuseConflictCopy(root, previous, remoteVersionId))) {
    copyPath = previous.conflict_paths![0]!
  } else {
    const remoteBytes = await downloadBytes(api, state.library_id, path, remoteVersionId)
    copyPath = await writeConflictCopy(root, path, "remote", remoteVersionId, remoteBytes, clock)
  }

  const localPath = resolveInsideRoot(root, path)
  const { body, digest } = await readStableUploadBody(localPath, local)
  const uploaded = await api.uploadFile(state.library_id, path, body, digest, remote.entry_version)

  const nextState = cloneDriveState(state)
  nextState.entries[path] = stateEntryFromRemote(uploaded.entry, digest, clock)
  delete nextState.conflicts[path]
  await writeDriveState(root, nextState, clock)
  return { state: nextState, copyPath }
}

async function recordRemoteConflictCopy(args: {
  root: string
  state: DriveState
  api: DrivePathActionApi
  path: string
  reason: string
  type: NonNullable<DriveConflict["type"]>
  remote: RemoteEntry | undefined
  clock: DriveClock
}): Promise<DriveState | undefined> {
  const { root, state, api, path, reason, type, remote, clock } = args
  const entry = state.entries[path]
  const remoteVersionId = remote?.current_version_id
  if (!remote || remoteVersionId === undefined) {
    return undefined
  }

  if (await canReuseConflictCopy(root, state.conflicts[path], remoteVersionId)) {
    return state
  }

  const remoteBytes = await downloadBytes(api, state.library_id, path, remoteVersionId)
  const copyPath = await writeConflictCopy(root, path, "remote", remoteVersionId, remoteBytes, clock)
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = {
    detected_at: driveIsoTimestamp(clock),
    reason,
    type,
    strategy: "conflict_copy",
    base_version_id: entry?.current_version_id,
    remote_version_id: remoteVersionId,
    remote_entry_version: remote.entry_version,
    conflict_paths: [copyPath],
  }
  await writeDriveState(root, nextState, clock)
  return nextState
}

async function canReuseConflictCopy(
  root: string,
  conflict: DriveConflict | undefined,
  remoteVersionId: string,
): Promise<boolean> {
  if (
    conflict?.strategy !== "conflict_copy" ||
    conflict.remote_version_id !== remoteVersionId ||
    !Array.isArray(conflict.conflict_paths) ||
    conflict.conflict_paths.length === 0
  ) {
    return false
  }

  for (const conflictPath of conflict.conflict_paths) {
    try {
      validateDrivePath(conflictPath)
      if (!(await localFileExists(resolveInsideRoot(root, conflictPath)))) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

async function writeConflictCopy(
  root: string,
  path: string,
  side: "remote" | "local",
  versionId: string,
  bytes: Uint8Array,
  clock: DriveClock,
): Promise<string> {
  const baseCopyPath = conflictCopyPath(path, side, driveConflictTimestamp(clock), versionId)
  for (let suffix = 1; ; suffix += 1) {
    const candidate = conflictCopyPathWithSuffix(baseCopyPath, suffix)
    validateDrivePath(candidate)
    const target = resolveInsideRoot(root, candidate)
    await mkdir(dirname(target), { recursive: true })

    for (;;) {
      const tmp = join(dirname(target), `.${basename(target)}.wspc-conflict-${randomUUID()}.tmp`)
      let tmpWritten = false
      try {
        await writeFile(tmp, bytes, { flag: "wx" })
        tmpWritten = true
        await installNoOverwrite(tmp, target)
        return candidate
      } catch (error) {
        if (tmpWritten) {
          await rm(tmp, { force: true }).catch(() => {})
        }
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
          if (tmpWritten) break
          continue
        }
        throw error
      }
    }
  }
}

function conflictCopyPathWithSuffix(path: string, suffix: number): string {
  if (suffix === 1) {
    return path
  }
  const parsed = pathPosix.parse(path)
  const fileName = `${parsed.name}-${suffix}${parsed.ext}`
  if (parsed.dir === "") {
    return fileName
  }
  return pathPosix.join(parsed.dir, fileName)
}

function isExpectedVersionDownloadMissing(error: unknown): boolean {
  const structured = error as { code?: unknown; status?: unknown; response?: { status?: unknown } } | undefined
  if (structured?.status === 404 || structured?.status === 410) return true
  if (structured?.response?.status === 404 || structured?.response?.status === 410) return true
  if (structured?.code === "VERSION_NOT_FOUND" || structured?.code === "NOT_FOUND") return true
  return /\b(?:HTTP 40[410]|missing version|version not found|not found)\b/i.test(errorMessage(error))
}

export function stateEntryFromRemote(
  remote: RemoteEntry,
  localSha256: string | undefined,
  clock: DriveClock,
): DriveStateEntry {
  return {
    entry_id: remote.id,
    entry_version: remote.entry_version,
    current_version_id: remote.current_version_id,
    content_sha256: remote.content_sha256,
    size_bytes: remote.size_bytes,
    last_local_sha256: localSha256,
    last_synced_at: driveIsoTimestamp(clock),
    status: "synced",
  }
}

export function cloneDriveState(state: DriveState): DriveState {
  return {
    ...state,
    entries: { ...state.entries },
    conflicts: { ...state.conflicts },
    ...(state.scan_errors === undefined ? {} : { scan_errors: { ...state.scan_errors } }),
  }
}

async function recordConflict(
  root: string,
  state: DriveState,
  path: string,
  reason: string,
  remote: RemoteEntry | undefined,
  clock: DriveClock,
): Promise<DriveState> {
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = conflict(reason, remote, clock)
  await writeDriveState(root, nextState, clock)
  return nextState
}

async function recordTypedConflict(
  root: string,
  state: DriveState,
  path: string,
  reason: string,
  remote: RemoteEntry | undefined,
  clock: DriveClock,
  metadata: Pick<DriveConflict, "type" | "strategy"> & { reason?: string },
): Promise<DriveState> {
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = {
    ...conflict(metadata.reason ?? reason, remote, clock),
    type: metadata.type,
    strategy: metadata.strategy,
    base_version_id: state.entries[path]?.current_version_id,
  }
  await writeDriveState(root, nextState, clock)
  return nextState
}

export async function recordDrivePathError(
  summary: DriveSyncSummary,
  blockedPaths: Set<string> | undefined,
  path: string,
  error: unknown,
  options: { appendPathResult?: boolean; debug?: DriveDebugLogger; op?: string; pathError?: DrivePathErrorSummary } = {},
): Promise<void> {
  blockedPaths?.add(path)
  const pathError = options.pathError ?? drivePathErrorSummary(path, error)
  const pathErrors = summary.path_errors ?? (summary.path_errors = [])
  if (pathErrors.some((candidate) => candidate.path === path)) return

  const lastPath = summary.paths.at(-1)
  if (!options.appendPathResult && lastPath?.path === path) {
    lastPath.action = "error"
  } else {
    summary.paths.push({ path, action: "error" })
  }
  pathErrors.push(pathError)
  pathErrors.sort((left, right) => left.path.localeCompare(right.path))
  options.debug?.log("error", {
    path,
    ...(options.op === undefined ? {} : { op: options.op }),
    code: pathError.code,
    message: pathError.message,
  })
  summary.errors += 1
}

export function drivePathErrorSummary(path: string, error: unknown): DrivePathErrorSummary {
  const structured = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined
  const message = typeof structured?.message === "string" ? structured.message : errorMessage(error)
  const code = typeof structured?.code === "string"
    ? structured.code
    : message.startsWith("invalid drive path:")
      ? "INVALID_DRIVE_PATH"
      : "DRIVE_PATH_ERROR"
  const retryable = typeof structured?.retryable === "boolean"
    ? structured.retryable
    : code === "ENOENT" || code === "EPERM" || code === "EBUSY"
  return { path, code, message, retryable }
}

function conflict(reason: string, remote: RemoteEntry | undefined, clock: DriveClock): DriveConflict {
  return {
    detected_at: driveIsoTimestamp(clock),
    reason,
    remote_entry_version: remote?.entry_version,
    remote_version_id: remote?.current_version_id,
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isVersionConflict(error: unknown): boolean {
  const structured = error as { body?: unknown; code?: unknown; response?: { body?: unknown } } | undefined
  if (structured?.code === "VERSION_CONFLICT") return true
  return [errorMessage(error), structured?.body, structured?.response?.body].some(containsVersionConflict)
}

function isLocalChangedDuringMerge(error: unknown): boolean {
  return errorMessage(error) === "local file changed after scan"
}

function containsVersionConflict(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value === "string") return value.includes("VERSION_CONFLICT")
  try {
    return JSON.stringify(value).includes("VERSION_CONFLICT")
  } catch {
    return false
  }
}

import { Command } from "commander"
import { createWriteStream } from "node:fs"
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, posix as pathPosix, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { createDriveApi } from "./api.js"
import { decideDriveAction, type DriveAction } from "./decision.js"
import { classifyMergeText, conflictCopyPath, mergeText3 } from "./merge.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"
import { hashDriveFile, scanDriveFiles } from "./scanner.js"
import {
  readDriveState,
  writeDriveState,
  withDriveLock,
  type DriveConflict,
  type DriveState,
  type DriveStateEntry,
} from "./state.js"
import { render } from "../../output/render.js"
import type { DriveManifestResponse, UploadDriveFileResponse } from "../../../generated/sdk/index.js"

type RemoteEntry = DriveManifestResponse["entries"][number]
type ProcessPathResult = { state: DriveState; stop: boolean }

export interface DriveSyncApi {
  getManifest(id: string, cursor?: string): Promise<DriveManifestResponse>
  uploadFile(
    id: string,
    path: string,
    body: BodyInit,
    sha256: string,
    expectedEntryVersion?: number,
  ): Promise<UploadDriveFileResponse>
  downloadFile(id: string, path: string, versionId?: string): Promise<Response>
  deleteFile(id: string, path: string, expectedEntryVersion: number): Promise<unknown>
}

export type DriveSyncPathAction = DriveAction["type"] | "error" | "merged"

export interface DriveSyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  unchanged: number
  merged: number
  conflicts: number
  errors: number
  conflict_paths: string[]
  paths: Array<{ path: string; action: DriveSyncPathAction; conflict_paths?: string[] }>
}

function emptySummary(): DriveSyncSummary {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    unchanged: 0,
    merged: 0,
    conflicts: 0,
    errors: 0,
    conflict_paths: [],
    paths: [],
  }
}

export async function runDriveSyncOnce(root: string, api?: DriveSyncApi): Promise<DriveSyncSummary> {
  return withDriveLock(root, async () => {
    let state = await readDriveState(root)
    const syncApi = api ?? (await createDriveApi())
    const summary = emptySummary()
    const blockedPaths = new Set<string>()
    const localFiles = await scanDriveFiles(root, {
      onPathError: async (path, error) => {
        await recordPathError(summary, blockedPaths, path, error)
      },
    })
    const remoteFiles = await fetchRemoteManifest(root, state, syncApi, summary, blockedPaths)
    const paths = Array.from(
      new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles), ...Object.keys(state.entries)]),
    )
      .filter((path) => !blockedPaths.has(path))
      .sort((left, right) => left.localeCompare(right))

    for (const path of paths) {
      const remote = remoteFiles[path]
      const action = decideDriveAction(state.entries[path], localFiles[path], remote)
      const result = await processPath({ root, state, api: syncApi, path, action, remote, local: localFiles[path], summary })
      state = result.state
      if (result.stop) break
    }

    recordUnresolvedConflicts(summary, state)
    return summary
  })
}

export function driveSyncCommand(api?: DriveSyncApi): Command {
  const sync = new Command("sync").description("Drive sync commands")
  sync
    .command("once")
    .description("Run one Drive sync pass")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string) => {
      const summary = await runDriveSyncOnce(resolve(path), api)
      render({ kind: "drive_sync_once", display: { shape: "object" } }, summary)
      if (summary.conflicts > 0 || summary.errors > 0) {
        process.exitCode = 1
      }
    })
  return sync
}

async function fetchRemoteManifest(
  root: string,
  state: DriveState,
  api: DriveSyncApi,
  summary: DriveSyncSummary,
  blockedPaths: Set<string>,
): Promise<Record<string, RemoteEntry>> {
  const candidates: RemoteEntry[] = []
  const remoteFiles: Record<string, RemoteEntry> = {}
  let cursor: string | undefined
  do {
    const page = await api.getManifest(state.library_id, cursor)
    for (const entry of page.entries) {
      try {
        validateRemoteEntry(root, entry)
        candidates.push(entry)
      } catch (error) {
        await recordPathError(summary, blockedPaths, entry.path, error)
      }
    }
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)

  const byCaseFoldedPath = new Map<string, RemoteEntry[]>()
  for (const entry of candidates) {
    const folded = entry.path.toLowerCase()
    const group = byCaseFoldedPath.get(folded) ?? []
    group.push(entry)
    byCaseFoldedPath.set(folded, group)
  }

  for (const group of byCaseFoldedPath.values()) {
    const exactPathCounts = new Map<string, number>()
    for (const entry of group) {
      exactPathCounts.set(entry.path, (exactPathCounts.get(entry.path) ?? 0) + 1)
    }

    if (group.length > 1) {
      const hasExactDuplicate = Array.from(exactPathCounts.values()).some((count) => count > 1)
      const reason = hasExactDuplicate ? "REMOTE_PATH_DUPLICATE" : "REMOTE_PATH_CASE_CONFLICT"
      for (const entry of group.sort((left, right) => left.path.localeCompare(right.path))) {
        await recordPathError(summary, blockedPaths, entry.path, new Error(`${reason}: ${entry.path}`), {
          appendPathResult: true,
        })
      }
      continue
    }

    const [entry] = group
    if (entry) remoteFiles[entry.path] = entry
  }
  return remoteFiles
}

function validateRemoteEntry(root: string, entry: RemoteEntry): void {
  validateDrivePath(entry.path)
  resolveInsideRoot(root, entry.path)
}

async function processPath(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  path: string
  action: DriveAction
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  summary: DriveSyncSummary
}): Promise<ProcessPathResult> {
  const { root, state, api, path, action, remote, local, summary } = args
  summary.paths.push({ path, action: action.type })
  let durableStateRequired = false

  try {
    if (action.type === "upload_create" || action.type === "upload_update") {
      const localPath = resolveInsideRoot(root, path)
      const { body, digest: uploadDigest } = await readStableUploadBody(localPath, local)
      const uploaded = await api.uploadFile(state.library_id, path, body, uploadDigest, action.expectedEntryVersion)
      durableStateRequired = true
      const nextState = cloneDriveState(state)
      nextState.entries[path] = stateEntryFromRemote(uploaded.entry, uploadDigest)
      delete nextState.conflicts[path]
      await commitDriveState(root, nextState)
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
      nextState.entries[path] = stateEntryFromRemote(remote, digest)
      delete nextState.conflicts[path]
      await commitDriveState(root, nextState)
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
      await commitDriveState(root, nextState)
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
      await commitDriveState(root, nextState)
      summary.deleted += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "state_only") {
      if (!remote) throw new Error("remote entry missing for state update")
      const nextState = cloneDriveState(state)
      nextState.entries[path] = stateEntryFromRemote(remote, local?.sha256 ?? remote.content_sha256)
      delete nextState.conflicts[path]
      await commitDriveState(root, nextState)
      summary.unchanged += 1
      return { state: nextState, stop: false }
    }

    if (action.type === "remove_state") {
      const nextState = cloneDriveState(state)
      delete nextState.entries[path]
      delete nextState.conflicts[path]
      await commitDriveState(root, nextState)
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
          const nextState = await recordTypedConflict(root, state, path, action.reason, remote, {
            type: "edit_edit",
            strategy: "record_only",
            reason: "local_changed_during_merge",
          })
          summary.conflicts += 1
          return { state: nextState, stop: false }
        }
        const conflictCopyState = await recordRemoteConflictCopy({
          root,
          state,
          api,
          path,
          reason: action.reason,
          type: "edit_edit",
          remote,
        })
        if (conflictCopyState) {
          summary.conflicts += 1
          return { state: conflictCopyState, stop: false }
        }
      }
      if (action.reason === "local_and_remote_without_base") {
        const conflictCopyState = await recordRemoteConflictCopy({
          root,
          state,
          api,
          path,
          reason: action.reason,
          type: "create_create",
          remote,
        })
        if (conflictCopyState) {
          summary.conflicts += 1
          return { state: conflictCopyState, stop: false }
        }
      }
      if (action.reason === "local_changed_remote_deleted") {
        const nextState = await recordTypedConflict(root, state, path, action.reason, remote, {
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
        })
        if (conflictCopyState) {
          summary.conflicts += 1
          return { state: conflictCopyState, stop: false }
        }
      }
      const nextState = await recordConflict(root, state, path, action.reason, remote)
      summary.conflicts += 1
      return { state: nextState, stop: false }
    }

    summary.unchanged += 1
  } catch (error) {
    if (isVersionConflict(error)) {
      try {
        const nextState = await recordConflict(root, state, path, "VERSION_CONFLICT", remote)
        summary.conflicts += 1
        summary.paths[summary.paths.length - 1] = { path, action: "conflict" }
        return { state: nextState, stop: false }
      } catch (writeError) {
        await recordPathError(summary, undefined, path, writeError)
        return { state, stop: durableStateRequired }
      }
    }
    await recordPathError(summary, undefined, path, error)
    return { state, stop: durableStateRequired }
  }
  return { state, stop: false }
}

async function tryResolveConflict(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  path: string
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  onLocalMutation: () => void
}): Promise<DriveState | undefined> {
  const { root, state, api, path, remote, local, onLocalMutation } = args
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
  await writeMergedLocalFile(root, path, mergedBytes, local, onLocalMutation)
  const uploaded = await api.uploadFile(state.library_id, path, mergedBytes, mergedDigest, remote.entry_version)

  const nextState = cloneDriveState(state)
  nextState.entries[path] = stateEntryFromRemote(uploaded.entry, mergedDigest)
  delete nextState.conflicts[path]
  await commitDriveState(root, nextState)
  return nextState
}

async function downloadBytes(api: DriveSyncApi, libraryId: string, path: string, versionId: string): Promise<Uint8Array> {
  const response = await api.downloadFile(libraryId, path, versionId)
  return new Uint8Array(await response.arrayBuffer())
}

async function recordRemoteConflictCopy(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  path: string
  reason: string
  type: NonNullable<DriveConflict["type"]>
  remote: RemoteEntry | undefined
}): Promise<DriveState | undefined> {
  const { root, state, api, path, reason, type, remote } = args
  const entry = state.entries[path]
  const remoteVersionId = remote?.current_version_id
  if (!remote || remoteVersionId === undefined) {
    return undefined
  }

  if (await canReuseConflictCopy(root, state.conflicts[path], remoteVersionId)) {
    return state
  }

  const remoteBytes = await downloadBytes(api, state.library_id, path, remoteVersionId)
  const copyPath = await writeConflictCopy(root, path, "remote", remoteVersionId, remoteBytes)
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = {
    detected_at: new Date().toISOString(),
    reason,
    type,
    strategy: "conflict_copy",
    base_version_id: entry?.current_version_id,
    remote_version_id: remoteVersionId,
    remote_entry_version: remote.entry_version,
    conflict_paths: [copyPath],
  }
  await commitDriveState(root, nextState)
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
): Promise<string> {
  const baseCopyPath = conflictCopyPath(path, side, new Date(), versionId)
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
        if (isAlreadyExistsError(error)) {
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

async function assertLocalStillScanned(
  localPath: string,
  scanned: { sha256: string; size_bytes: number },
): Promise<void> {
  const snapshot = await hashDriveFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!snapshot || snapshot.sha256 !== scanned.sha256 || snapshot.sizeBytes !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
}

function recordUnresolvedConflicts(summary: DriveSyncSummary, state: DriveState): void {
  const newlyRecorded = new Set(summary.paths.filter((result) => result.action === "conflict").map((result) => result.path))
  const reportedPaths = new Set(summary.paths.map((result) => result.path))
  for (const path of Object.keys(state.conflicts).sort((left, right) => left.localeCompare(right))) {
    const conflictPaths = state.conflicts[path]?.conflict_paths
    if (conflictPaths) {
      summary.conflict_paths.push(...conflictPaths)
    }
    if (!newlyRecorded.has(path)) {
      summary.conflicts += 1
    }
    const existingResult = summary.paths.find((result) => result.path === path)
    if (existingResult?.action === "unchanged") {
      existingResult.action = "conflict"
      if (conflictPaths) existingResult.conflict_paths = conflictPaths
      continue
    }
    if (existingResult?.action === "conflict" && conflictPaths) {
      existingResult.conflict_paths = conflictPaths
    }
    if (!reportedPaths.has(path)) {
      summary.paths.push({ path, action: "conflict", ...(conflictPaths ? { conflict_paths: conflictPaths } : {}) })
    }
  }
}

async function writeMergedLocalFile(
  root: string,
  path: string,
  bytes: Uint8Array,
  scanned: { sha256: string; size_bytes: number },
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.wspc-merge-${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, bytes, { flag: "wx" })
    await installMergedLocalFile(root, path, tmp, scanned, onLocalMutation)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function installMergedLocalFile(
  root: string,
  path: string,
  tmp: string,
  scanned: { sha256: string; size_bytes: number },
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  let backupIsScannedLocal = false

  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error("local file changed after scan")
      }
      throw error
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest || backupDigest.sha256 !== scanned.sha256 || backupDigest.sizeBytes !== scanned.size_bytes) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed after scan")
    }
    backupIsScannedLocal = true

    try {
      await installNoOverwrite(tmp, target)
    } catch (error) {
      await restoreBackupWhenPossible(backup, target)
      throw error
    }
    await unlink(backup)
  } catch (error) {
    if (!backupIsScannedLocal) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

async function downloadRemote(
  root: string,
  libraryId: string,
  path: string,
  api: DriveSyncApi,
  expectedSha256: string | undefined,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<string> {
  const target = resolveInsideRoot(root, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.wspc-download-${randomUUID()}.tmp`)
  try {
    const response = await api.downloadFile(libraryId, path)
    if (!response.body) {
      throw new Error("download response body missing")
    }
    const hash = createHash("sha256")
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback(undefined, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      hashingStream,
      createWriteStream(tmp, { flags: "wx" }),
    )
    const digest = hash.digest("hex")
    if (expectedSha256 !== undefined && digest !== expectedSha256) {
      throw new Error(`download hash mismatch: expected ${expectedSha256}, got ${digest}`)
    }
    await installDownloadedFile(root, path, tmp, entry, onLocalMutation)
    return digest
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function installDownloadedFile(
  root: string,
  path: string,
  tmp: string,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  const expectedSha256 = expectedLocalBaseSha256(entry)
  let backupIsExpectedBase = false

  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      await installNoOverwrite(tmp, target, onLocalMutation)
      return
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before download")
    }
    if (!expectedSha256 || backupDigest.sha256 !== expectedSha256) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before download")
    }
    backupIsExpectedBase = true

    try {
      await installNoOverwrite(tmp, target, onLocalMutation)
    } catch (error) {
      const restored = await restoreBackupWhenPossible(backup, target)
      if (!restored && backupIsExpectedBase) {
        await unlink(backup).catch(() => {})
      }
      throw error
    }
    await unlink(backup)
  } catch (error) {
    if (!backupIsExpectedBase) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

async function removeLocalIfStillBase(
  root: string,
  path: string,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  const expectedSha256 = expectedLocalBaseSha256(entry)
  if (!expectedSha256) {
    throw new Error("local file has no sync base")
  }

  let backupIsExpectedBase = false
  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error("local file changed before delete")
      }
      throw error
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest || backupDigest.sha256 !== expectedSha256) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before delete")
    }
    backupIsExpectedBase = true

    if (await localFileExists(target)) {
      await unlink(backup).catch(() => {})
      throw new Error("local file reappeared during delete")
    }
    await unlink(backup)
    if (await localFileExists(target)) {
      throw new Error("local file reappeared during delete")
    }
  } catch (error) {
    if (!backupIsExpectedBase) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

async function installNoOverwrite(source: string, target: string, onLinked?: () => void): Promise<void> {
  await link(source, target)
  onLinked?.()
  await unlink(source)
}

async function restoreBackupWhenPossible(backup: string, target: string): Promise<boolean> {
  try {
    await installNoOverwrite(backup, target)
    return true
  } catch (error) {
    if (isAlreadyExistsError(error)) return false
    if (isNotFoundError(error)) return true
    return false
  }
}

async function localFileExists(path: string): Promise<boolean> {
  const digest = await hashDriveFile(path).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  return digest !== undefined
}

function localMutationBackupPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.wspc-backup-${randomUUID()}.tmp`)
}

function expectedLocalBaseSha256(entry: DriveStateEntry | undefined): string | undefined {
  return entry?.last_local_sha256 ?? entry?.content_sha256
}

async function readStableUploadBody(
  localPath: string,
  scanned: { sha256: string; size_bytes: number } | undefined,
): Promise<{ body: ArrayBuffer; digest: string }> {
  if (!scanned) {
    throw new Error("local file missing from scan")
  }
  const snapshot = await hashDriveFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!snapshot || snapshot.sha256 !== scanned.sha256 || snapshot.sizeBytes !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
  const body = await readFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!body) {
    throw new Error("local file changed after scan")
  }
  const uploadBytes = new Uint8Array(body.byteLength)
  uploadBytes.set(body)
  const digest = createHash("sha256").update(uploadBytes).digest("hex")
  if (digest !== scanned.sha256 || uploadBytes.byteLength !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
  return { body: uploadBytes.buffer, digest }
}

async function assertLocalSafeForDownload(
  root: string,
  path: string,
  entry: DriveStateEntry | undefined,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const digest = await hashDriveFile(target).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!digest) return

  if (!entry?.last_local_sha256) {
    throw new Error("local file appeared before download")
  }
  if (digest.sha256 !== entry.last_local_sha256) {
    throw new Error("local file changed before download")
  }
}

async function assertLocalAbsentBeforeRemoteDelete(root: string, path: string): Promise<void> {
  const digest = await hashDriveFile(resolveInsideRoot(root, path)).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (digest) {
    throw new Error("local file appeared before remote delete")
  }
}

function stateEntryFromRemote(remote: RemoteEntry, localSha256: string | undefined): DriveStateEntry {
  return {
    entry_id: remote.id,
    entry_version: remote.entry_version,
    current_version_id: remote.current_version_id,
    content_sha256: remote.content_sha256,
    size_bytes: remote.size_bytes,
    last_local_sha256: localSha256,
    last_synced_at: new Date().toISOString(),
    status: "synced",
  }
}

async function commitDriveState(root: string, nextState: DriveState): Promise<void> {
  await writeDriveState(root, nextState)
}

function cloneDriveState(state: DriveState): DriveState {
  return {
    ...state,
    entries: { ...state.entries },
    conflicts: { ...state.conflicts },
  }
}

async function recordConflict(
  root: string,
  state: DriveState,
  path: string,
  reason: string,
  remote: RemoteEntry | undefined,
): Promise<DriveState> {
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = conflict(reason, remote)
  await commitDriveState(root, nextState)
  return nextState
}

async function recordTypedConflict(
  root: string,
  state: DriveState,
  path: string,
  reason: string,
  remote: RemoteEntry | undefined,
  metadata: Pick<DriveConflict, "type" | "strategy"> & { reason?: string },
): Promise<DriveState> {
  const nextState = cloneDriveState(state)
  nextState.conflicts[path] = {
    ...conflict(metadata.reason ?? reason, remote),
    type: metadata.type,
    strategy: metadata.strategy,
    base_version_id: state.entries[path]?.current_version_id,
  }
  await commitDriveState(root, nextState)
  return nextState
}

async function recordPathError(
  summary: DriveSyncSummary,
  blockedPaths: Set<string> | undefined,
  path: string,
  error: unknown,
  options: { appendPathResult?: boolean } = {},
): Promise<void> {
  blockedPaths?.add(path)
  const lastPath = summary.paths.at(-1)
  if (!options.appendPathResult && lastPath?.path === path) {
    lastPath.action = "error"
  } else {
    summary.paths.push({ path, action: "error" })
  }
  void errorMessage(error)
  summary.errors += 1
}

function conflict(reason: string, remote: RemoteEntry | undefined): DriveConflict {
  return {
    detected_at: new Date().toISOString(),
    reason,
    remote_entry_version: remote?.entry_version,
    remote_version_id: remote?.current_version_id,
  }
}

function errorMessage(error: unknown): string {
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

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  )
}

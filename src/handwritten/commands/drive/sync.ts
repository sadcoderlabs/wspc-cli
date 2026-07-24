import { Command } from "commander"
import { resolve } from "node:path"
import { createDriveApi } from "./api.js"
import { noopDriveDebugLogger, type DriveDebugLogger } from "./debug-log.js"
import { systemDriveClock, type DriveClock } from "./clock.js"
import { decideDriveAction, type DriveAction } from "./decision.js"
import { loadDriveExcludeRules, type DriveExcludeRules } from "./exclude-rules.js"
import { normalizeRemoteManifest } from "./manifest.js"
import { rescanDriveFiles, scanDriveFiles } from "./scanner.js"
import {
  readDriveState,
  writeDriveState,
  withDriveLock,
  type DriveScanCacheEntry,
  type DriveScanError,
  type DriveState,
  type DriveStateEntry,
} from "./state.js"
import { render } from "../../output/render.js"
import {
  DriveRetryableSyncError,
  isDriveAuthFailure,
  isRetryableDriveFailure,
} from "./retry.js"
import {
  cloneDriveState,
  drivePathErrorSummary,
  errorMessage,
  executeDrivePathAction,
  recordDrivePathError,
  stateEntryFromRemote,
  type DrivePathExecutionResult,
} from "./path-executor.js"
import type {
  DriveSyncApi,
  DriveSyncSummary,
  RemoteEntry,
} from "./sync-contracts.js"

export type {
  DriveSyncApi,
  DriveSyncPathAction,
  DriveSyncSummary,
} from "./sync-contracts.js"

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
    path_errors: [],
    paths: [],
  }
}

export type DriveSyncProgress = (processed: number, total: number) => void

// Progress counts actionable paths only (transfers and conflict handling);
// counting unchanged/state-only paths would make incremental syncs jump to
// ~100% instantly and stall there.
function isActionableAction(action: DriveAction): boolean {
  return action.type !== "unchanged" && action.type !== "state_only" && action.type !== "remove_state"
}

export interface DriveSyncOnceOptions {
  // Incremental scan: only these paths are re-stat/hashed; the rest of the
  // local view comes from state.scan_cache. Requires a warm cache.
  dirtyPaths?: string[]
}

export async function runDriveSyncOnce(
  root: string,
  api?: DriveSyncApi,
  clock: DriveClock = systemDriveClock,
  onProgress?: DriveSyncProgress,
  debug: DriveDebugLogger = noopDriveDebugLogger,
  options: DriveSyncOnceOptions = {},
): Promise<DriveSyncSummary> {
  return withDriveLock(root, async () => {
    let state = await readDriveState(root)
    const excludeRules = await loadDriveExcludeRules(root)
    const stateWithoutExcludedPaths = removeExcludedState(state, excludeRules)
    if (stateWithoutExcludedPaths !== state) {
      state = stateWithoutExcludedPaths
      await writeDriveState(root, state, clock)
    }
    const syncApi = api ?? (await createDriveApi({ clientId: state.realtime?.client_id }))
    const summary = emptySummary()
    const blockedPaths = new Set<string>()
    const scanStartedMs = Date.now()
    const useIncrementalScan = options.dirtyPaths !== undefined && state.scan_cache !== undefined
    const nextScanCache: Record<string, DriveScanCacheEntry> = {}
    const nextScanErrors: Record<string, DriveScanError> = useIncrementalScan
      ? retainUnrelatedScanErrors(state.scan_errors, options.dirtyPaths!)
      : {}
    const scanOptions = {
      cache: state.scan_cache,
      excludeRules,
      onCacheUpdate: (path: string, entry: DriveScanCacheEntry) => {
        nextScanCache[path] = entry
      },
      onPathError: (path: string, error: unknown) => {
        const pathError = drivePathErrorSummary(path, error)
        nextScanErrors[path] = {
          code: pathError.code,
          message: pathError.message,
          retryable: pathError.retryable,
        }
      },
    }
    const localFiles = useIncrementalScan
      ? await rescanDriveFiles(root, options.dirtyPaths!, scanOptions)
      : await scanDriveFiles(root, scanOptions)
    for (const path of Object.keys(nextScanErrors).sort((left, right) => left.localeCompare(right))) {
      const pathError = { path, ...nextScanErrors[path]! }
      await recordDrivePathError(summary, blockedPaths, path, pathError, { debug, op: "scan", pathError })
    }
    if (
      JSON.stringify(state.scan_cache ?? {}) !== JSON.stringify(nextScanCache) ||
      JSON.stringify(state.scan_errors ?? {}) !== JSON.stringify(nextScanErrors)
    ) {
      const nextState: DriveState = { ...state, scan_cache: nextScanCache, scan_errors: nextScanErrors }
      if (Object.keys(nextScanErrors).length === 0) delete nextState.scan_errors
      state = nextState
      await writeDriveState(root, state, clock)
    }
    const scanMs = Date.now() - scanStartedMs
    const manifestStartedMs = Date.now()
    let manifest: Awaited<ReturnType<typeof fetchRemoteManifest>>
    try {
      manifest = await fetchRemoteManifest(root, state, syncApi, summary, blockedPaths, debug)
    } catch (error) {
      if (isRetryableDriveFailure(error)) {
        throw new DriveRetryableSyncError(error, { pathErrors: summary.path_errors ?? [] })
      }
      throw error
    }
    const remoteFiles = removeExcludedFiles(manifest.remoteFiles, excludeRules)
    if (manifest.manifestCursor !== undefined && manifest.manifestCursor !== state.manifest_cursor) {
      state = { ...state, manifest_cursor: manifest.manifestCursor }
      await writeDriveState(root, state, clock)
    }
    const manifestMs = Date.now() - manifestStartedMs
    const paths = Array.from(
      new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles), ...Object.keys(state.entries)]),
    )
      .filter((path) => !blockedPaths.has(path) && !excludeRules.matches(path))
      .sort((left, right) => left.localeCompare(right))

    let movedPaths: Set<string>
    try {
      movedPaths = await applyRenamesAsMoves({
        root,
        state,
        api: syncApi,
        paths,
        localFiles,
        remoteFiles,
        summary,
        clock,
        debug,
        onStateChange: (nextState) => {
          state = nextState
        },
      })
    } catch (error) {
      if (isRetryableDriveFailure(error)) {
        throw new DriveRetryableSyncError(error, { pathErrors: summary.path_errors ?? [] })
      }
      throw error
    }

    // decideDriveAction is pure and reads only this path's slices of the
    // initial state, so this pre-pass total matches the loop's actions.
    const total = paths.filter(
      (path) =>
        !movedPaths.has(path) &&
        isActionableAction(decideDriveAction(state.entries[path], localFiles[path], remoteFiles[path])),
    ).length
    let processed = 0
    onProgress?.(processed, total)

    const processStartedMs = Date.now()
    for (const path of paths) {
      if (movedPaths.has(path)) continue
      const remote = remoteFiles[path]
      const local = localFiles[path]
      const action = decideDriveAction(state.entries[path], local, remote)
      if (isActionableAction(action)) {
        debug.log("decision", decisionFields(path, action, state.entries[path], local, remote))
      }
      const previousConflict = state.conflicts[path]
      let result: DrivePathExecutionResult
      try {
        result = await executeDrivePathAction({
          root,
          state,
          api: syncApi,
          path,
          action,
          remote,
          local,
          summary,
          clock,
          debug,
        })
      } catch (error) {
        if (isRetryableDriveFailure(error)) {
          throw new DriveRetryableSyncError(error, {
            remaining: total - processed,
            pathErrors: summary.path_errors ?? [],
          })
        }
        throw error
      }
      state = result.state
      const recordedConflict = state.conflicts[path]
      if (recordedConflict !== undefined && recordedConflict !== previousConflict) {
        debug.log("conflict", {
          path,
          reason: recordedConflict.reason,
          ...(recordedConflict.type === undefined ? {} : { type: recordedConflict.type }),
          ...(recordedConflict.strategy === undefined ? {} : { strategy: recordedConflict.strategy }),
          ...(recordedConflict.conflict_paths === undefined ? {} : { conflict_paths: recordedConflict.conflict_paths }),
        })
      }
      if (isActionableAction(action)) {
        processed += 1
        onProgress?.(processed, total)
      }
      if (result.stop) break
    }

    recordUnresolvedConflicts(summary, state)
    debug.log("sync_phases", { scan_ms: scanMs, manifest_ms: manifestMs, process_ms: Date.now() - processStartedMs })
    return summary
  })
}

function removeExcludedState(state: DriveState, excludeRules: DriveExcludeRules): DriveState {
  if (excludeRules.size === 0) return state
  const entries = removeExcludedFiles(state.entries, excludeRules)
  const conflicts = removeExcludedFiles(state.conflicts, excludeRules)
  const scanCache = removeExcludedFiles(state.scan_cache ?? {}, excludeRules)
  const scanErrors = removeExcludedFiles(state.scan_errors ?? {}, excludeRules)
  const changed =
    Object.keys(entries).length !== Object.keys(state.entries).length ||
    Object.keys(conflicts).length !== Object.keys(state.conflicts).length ||
    Object.keys(scanCache).length !== Object.keys(state.scan_cache ?? {}).length ||
    Object.keys(scanErrors).length !== Object.keys(state.scan_errors ?? {}).length
  if (!changed) return state

  const nextState: DriveState = {
    ...state,
    entries,
    conflicts,
    scan_cache: scanCache,
    scan_errors: scanErrors,
  }
  if (Object.keys(scanErrors).length === 0) delete nextState.scan_errors
  return nextState
}

function removeExcludedFiles<T>(files: Record<string, T>, excludeRules: DriveExcludeRules): Record<string, T> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !excludeRules.matches(path)))
}

function decisionFields(
  path: string,
  action: DriveAction,
  entry: DriveStateEntry | undefined,
  local: { sha256: string; size_bytes: number } | undefined,
  remote: RemoteEntry | undefined,
): Record<string, unknown> {
  return {
    path,
    action: action.type,
    ...("reason" in action && action.reason !== undefined ? { reason: action.reason } : {}),
    ...(entry === undefined
      ? {}
      : { base_version_id: entry.current_version_id, base_entry_version: entry.entry_version, base_sha256: entry.content_sha256 }),
    ...(local === undefined ? {} : { local_sha256: local.sha256, local_size_bytes: local.size_bytes }),
    ...(remote === undefined
      ? {}
      : { remote_version_id: remote.current_version_id, remote_entry_version: remote.entry_version, remote_sha256: remote.content_sha256 }),
  }
}

export function driveSyncCommand(api?: DriveSyncApi): Command {
  const sync = new Command("sync").description("Drive sync commands")
  sync
    .command("once")
    .description("Run one Drive sync pass")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string) => {
      let summary: DriveSyncSummary
      try {
        summary = await runDriveSyncOnce(resolve(path), api)
      } catch (error) {
        process.exitCode = 1
        throw error
      }
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
  debug: DriveDebugLogger,
): Promise<{ remoteFiles: Record<string, RemoteEntry>; manifestCursor: string | undefined }> {
  if (state.manifest_cursor !== undefined) {
    const delta = await api.getManifest(state.library_id, undefined, state.manifest_cursor)
    if (delta.resync_required !== true) {
      const remoteFiles = remoteViewFromState(state)
      const changed = delta.entries.filter((entry) => entry.deleted_at === undefined)
      const normalized = normalizeRemoteManifest(root, changed)
      for (const pathError of normalized.pathErrors) {
        await recordDrivePathError(summary, blockedPaths, pathError.path, pathError.error, {
          appendPathResult: pathError.appendPathResult,
          debug,
          op: "manifest",
        })
      }
      for (const entry of delta.entries) {
        if (entry.deleted_at !== undefined) delete remoteFiles[entry.path]
      }
      Object.assign(remoteFiles, normalized.remoteFiles)
      return { remoteFiles, manifestCursor: delta.latest_cursor ?? state.manifest_cursor }
    }
    // resync_required: cursor pruned or invalid, fall back to a full fetch.
  }

  const entries: RemoteEntry[] = []
  let cursor: string | undefined
  let latestCursor: string | undefined
  do {
    const page = await api.getManifest(state.library_id, cursor)
    entries.push(...page.entries)
    if (page.latest_cursor !== undefined) latestCursor = page.latest_cursor
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)

  const normalized = normalizeRemoteManifest(root, entries)
  for (const pathError of normalized.pathErrors) {
    await recordDrivePathError(summary, blockedPaths, pathError.path, pathError.error, {
      appendPathResult: pathError.appendPathResult,
      debug,
      op: "manifest",
    })
  }
  return { remoteFiles: normalized.remoteFiles, manifestCursor: latestCursor }
}

// Reconstructs the last-known remote view from base state so a manifest delta
// only has to carry what changed since the stored cursor.
function remoteViewFromState(state: DriveState): Record<string, RemoteEntry> {
  const remoteFiles: Record<string, RemoteEntry> = {}
  for (const [path, entry] of Object.entries(state.entries)) {
    remoteFiles[path] = {
      id: entry.entry_id,
      path,
      kind: "file",
      entry_version: entry.entry_version,
      size_bytes: entry.size_bytes,
      updated_at: entry.last_synced_at,
      ...(entry.current_version_id === undefined ? {} : { current_version_id: entry.current_version_id }),
      ...(entry.content_sha256 === undefined ? {} : { content_sha256: entry.content_sha256 }),
    }
  }
  return remoteFiles
}

// Detects local renames (a delete_remote and an upload_create with the same
// content hash) and applies them via the server move API, preserving version
// history and skipping a full re-upload. Only unambiguous 1:1 hash pairs are
// moved; anything else falls back to normal upload + delete processing.
async function applyRenamesAsMoves(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  paths: string[]
  localFiles: Record<string, { sha256: string; size_bytes: number }>
  remoteFiles: Record<string, RemoteEntry>
  summary: DriveSyncSummary
  clock: DriveClock
  debug: DriveDebugLogger
  onStateChange: (state: DriveState) => void
}): Promise<Set<string>> {
  const { root, api, paths, localFiles, remoteFiles, summary, clock, debug, onStateChange } = args
  const movedPaths = new Set<string>()
  if (api.moveFile === undefined) return movedPaths

  let state = args.state
  const deletesBySha = new Map<string, string[]>()
  const createsBySha = new Map<string, string[]>()
  for (const path of paths) {
    const action = decideDriveAction(state.entries[path], localFiles[path], remoteFiles[path])
    if (action.type === "delete_remote") {
      const sha = state.entries[path]?.last_local_sha256 ?? state.entries[path]?.content_sha256
      if (sha !== undefined) deletesBySha.set(sha, [...(deletesBySha.get(sha) ?? []), path])
    }
    if (action.type === "upload_create") {
      const sha = localFiles[path]?.sha256
      if (sha !== undefined) createsBySha.set(sha, [...(createsBySha.get(sha) ?? []), path])
    }
  }

  for (const [sha, fromPaths] of deletesBySha) {
    const toPaths = createsBySha.get(sha)
    if (fromPaths.length !== 1 || toPaths === undefined || toPaths.length !== 1) continue
    const fromPath = fromPaths[0]!
    const toPath = toPaths[0]!
    const entry = state.entries[fromPath]
    const local = localFiles[toPath]
    if (entry === undefined || local === undefined) continue
    try {
      const moved = await api.moveFile(state.library_id, fromPath, toPath, entry.entry_version)
      const nextState = cloneDriveState(state)
      delete nextState.entries[fromPath]
      delete nextState.conflicts[fromPath]
      nextState.entries[toPath] = stateEntryFromRemote(moved.entry, local.sha256, clock)
      delete nextState.conflicts[toPath]
      await writeDriveState(root, nextState, clock)
      state = nextState
      onStateChange(nextState)
      movedPaths.add(fromPath)
      movedPaths.add(toPath)
      summary.paths.push({ path: toPath, action: "move" })
      debug.log("decision", { path: toPath, action: "move", from_path: fromPath })
    } catch (error) {
      if (isRetryableDriveFailure(error) || isDriveAuthFailure(error)) throw error
      // Move is an optimization: on any failure fall back to upload + delete.
      debug.log("error", { path: toPath, op: "move", message: errorMessage(error) })
    }
  }
  return movedPaths
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

function retainUnrelatedScanErrors(
  current: Record<string, DriveScanError> | undefined,
  dirtyPaths: string[],
): Record<string, DriveScanError> {
  const retained: Record<string, DriveScanError> = {}
  for (const [path, error] of Object.entries(current ?? {})) {
    if (dirtyPaths.some((dirtyPath) => pathsOverlap(path, dirtyPath))) continue
    retained[path] = error
  }
  return retained
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

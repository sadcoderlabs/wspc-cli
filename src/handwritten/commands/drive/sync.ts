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
  type DriveUploadRejection,
} from "./state.js"
import { render } from "../../output/render.js"
import { VERSION } from "../../../version.js"
import {
  DriveRetryableSyncError,
  isDriveAuthFailure,
  isRetryableDriveFailure,
  type DrivePathErrorSummary,
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

// Mirrors MAX_FILE_SIZE_BYTES in sadcoderlabs/wspc packages/drive/worker/src/limits.ts;
// the server does not expose it, so a server change needs a CLI release.
const DRIVE_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

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
    const loadRemoteView = async (fullManifest: boolean): Promise<DriveRemoteView> => {
      let manifest: Awaited<ReturnType<typeof fetchRemoteManifest>>
      try {
        manifest = await fetchRemoteManifest(
          root,
          fullManifest ? { ...state, manifest_cursor: undefined } : state,
          syncApi,
          summary,
          blockedPaths,
          debug,
        )
      } catch (error) {
        if (isRetryableDriveFailure(error)) {
          throw new DriveRetryableSyncError(error, { pathErrors: summary.path_errors ?? [] })
        }
        throw error
      }
      const remoteFiles = removeExcludedPaths(manifest.remoteFiles, excludeRules)
      const paths = Array.from(
        new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles), ...Object.keys(state.entries)]),
      )
        .filter((path) => !blockedPaths.has(path) && !excludeRules.matches(path))
        .sort((left, right) => left.localeCompare(right))
      return { remoteFiles, paths, manifestCursor: manifest.manifestCursor, fromDelta: manifest.fromDelta }
    }
    let view = await loadRemoteView(false)
    const manifestMs = Date.now() - manifestStartedMs

    let plannedMoves =
      syncApi.moveFile === undefined ? [] : planRenameMoves(state, view.paths, localFiles, view.remoteFiles)

    // Uploads this round skips: Oversized Files first, then Permanent Upload
    // Rejections that still match this scan. Pure, so progress and the final
    // skip use the same answer.
    const uploadSkip = (path: string): { op: string; pathError: DrivePathErrorSummary } | undefined => {
      const action = decideDriveAction(state.entries[path], localFiles[path], view.remoteFiles[path])
      if (action.type !== "upload_create" && action.type !== "upload_update") return undefined
      const sizeBytes = localFiles[path]?.size_bytes
      if (sizeBytes !== undefined && sizeBytes > DRIVE_MAX_FILE_SIZE_BYTES) {
        return {
          op: "file_too_large",
          pathError: {
            path,
            code: "FILE_TOO_LARGE",
            message: `file is ${(sizeBytes / 1_048_576).toFixed(1)} MiB (${sizeBytes} bytes); Drive per-file limit is 100 MiB`,
            retryable: false,
          },
        }
      }
      const rejection = state.upload_rejections?.[path]
      if (rejection === undefined || !isCurrentUploadRejection(rejection, state.scan_cache?.[path])) return undefined
      return { op: "upload_rejected", pathError: { path, code: rejection.code, message: rejection.message, retryable: false } }
    }
    // decideDriveAction is pure and reads only this path's slices of state, so
    // a pre-pass count matches the loop's actions.
    const countActionable = (paths: string[], excluded: Set<string>) =>
      paths.filter(
        (path) =>
          !excluded.has(path) &&
          uploadSkip(path) === undefined &&
          isActionableAction(decideDriveAction(state.entries[path], localFiles[path], view.remoteFiles[path])),
      ).length
    let processed = 0
    let total = plannedMoves.length + countActionable(view.paths, pairPaths(plannedMoves))
    onProgress?.(processed, total)

    const settledPairPaths = new Set<string>()
    let fullManifestFetched = false
    for (;;) {
      let outcome: DriveRenameMovesOutcome
      try {
        outcome = await applyRenameMoves({
          root,
          state,
          api: syncApi,
          moves: plannedMoves,
          localFiles,
          summary,
          clock,
          debug,
          stopOnRejection: view.fromDelta && !fullManifestFetched,
          onStateChange: (nextState) => {
            state = nextState
          },
          onMoveSettled: () => {
            processed += 1
            onProgress?.(processed, total)
          },
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
      for (const path of outcome.settledPaths) settledPairPaths.add(path)
      if (!outcome.stoppedOnRejection) break
      // A delta view can be stale after an interrupted round; confirm with a full manifest before giving up on the pair.
      fullManifestFetched = true
      view = await loadRemoteView(true)
      plannedMoves = planRenameMoves(state, view.paths, localFiles, view.remoteFiles)
      const nextTotal =
        processed +
        plannedMoves.length +
        countActionable(view.paths, new Set([...settledPairPaths, ...pairPaths(plannedMoves)]))
      if (nextTotal !== total) {
        total = nextTotal
        onProgress?.(processed, total)
      }
    }

    // The view and the pairs are final here; the skips below must use them.
    const skippedUploads = new Set<string>()
    for (const path of view.paths) {
      if (settledPairPaths.has(path)) continue
      const skip = uploadSkip(path)
      if (skip === undefined) continue
      skippedUploads.add(path)
      await recordDrivePathError(summary, undefined, path, undefined, {
        appendPathResult: true,
        debug,
        op: skip.op,
        pathError: skip.pathError,
      })
    }
    const uploadRejections = Object.fromEntries(
      Object.entries(state.upload_rejections ?? {}).filter(([path, rejection]) =>
        isCurrentUploadRejection(rejection, state.scan_cache?.[path]),
      ),
    )
    if (Object.keys(uploadRejections).length !== Object.keys(state.upload_rejections ?? {}).length) {
      state = { ...state, upload_rejections: uploadRejections }
      if (Object.keys(uploadRejections).length === 0) delete state.upload_rejections
      await writeDriveState(root, state, clock)
    }

    const pendingPaths = view.paths.filter((path) => !settledPairPaths.has(path) && !skippedUploads.has(path))
    const pendingTotal = processed + countActionable(pendingPaths, settledPairPaths)
    if (pendingTotal !== total) {
      total = pendingTotal
      onProgress?.(processed, total)
    }

    const processStartedMs = Date.now()
    let roundCompleted = true
    for (const path of pendingPaths) {
      const remote = view.remoteFiles[path]
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
      if (result.stop) {
        roundCompleted = false
        break
      }
    }

    // The cursor is persisted only after every change it covers is applied; an
    // interrupted round replays the same delta next time instead of skipping it.
    if (!roundCompleted) {
      debug.log("manifest_cursor", { action: "keep", reason: "round_interrupted" })
    } else if (
      excludeRules.size === 0 &&
      view.manifestCursor !== undefined &&
      view.manifestCursor !== state.manifest_cursor
    ) {
      state = { ...state, manifest_cursor: view.manifestCursor }
      await writeDriveState(root, state, clock)
      debug.log("manifest_cursor", { action: "persist", cursor: view.manifestCursor })
    }

    recordUnresolvedConflicts(summary, state)
    debug.log("sync_phases", { scan_ms: scanMs, manifest_ms: manifestMs, process_ms: Date.now() - processStartedMs })
    return summary
  })
}

function removeExcludedState(state: DriveState, excludeRules: DriveExcludeRules): DriveState {
  if (excludeRules.size === 0) return state
  const entries = removeExcludedPaths(state.entries, excludeRules)
  const conflicts = removeExcludedPaths(state.conflicts, excludeRules)
  const scanCache = removeExcludedPaths(state.scan_cache ?? {}, excludeRules)
  const scanErrors = removeExcludedPaths(state.scan_errors ?? {}, excludeRules)
  const changed =
    state.manifest_cursor !== undefined ||
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
  delete nextState.manifest_cursor
  if (Object.keys(scanErrors).length === 0) delete nextState.scan_errors
  return nextState
}

function removeExcludedPaths<T>(records: Record<string, T>, excludeRules: DriveExcludeRules): Record<string, T> {
  return Object.fromEntries(Object.entries(records).filter(([path]) => !excludeRules.matches(path)))
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
): Promise<{ remoteFiles: Record<string, RemoteEntry>; manifestCursor: string | undefined; fromDelta: boolean }> {
  let resyncRequired = false
  if (state.manifest_cursor !== undefined) {
    const delta = await api.getManifest(state.library_id, undefined, state.manifest_cursor)
    if (delta.resync_required !== true) {
      debug.log("manifest", {
        mode: "delta",
        since_cursor: state.manifest_cursor,
        ...(delta.latest_cursor === undefined ? {} : { latest_cursor: delta.latest_cursor }),
        entries: delta.entries.length,
      })
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
      return { remoteFiles, manifestCursor: delta.latest_cursor ?? state.manifest_cursor, fromDelta: true }
    }
    // resync_required: cursor pruned or invalid, fall back to a full fetch.
    resyncRequired = true
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
  debug.log("manifest", {
    mode: "full",
    ...(latestCursor === undefined ? {} : { latest_cursor: latestCursor }),
    entries: entries.length,
    ...(resyncRequired ? { resync_required: true } : {}),
  })

  const normalized = normalizeRemoteManifest(root, entries)
  for (const pathError of normalized.pathErrors) {
    await recordDrivePathError(summary, blockedPaths, pathError.path, pathError.error, {
      appendPathResult: pathError.appendPathResult,
      debug,
      op: "manifest",
    })
  }
  return { remoteFiles: normalized.remoteFiles, manifestCursor: latestCursor, fromDelta: false }
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

interface DriveRemoteView {
  remoteFiles: Record<string, RemoteEntry>
  paths: string[]
  manifestCursor: string | undefined
  fromDelta: boolean
}

interface DriveRenameMove {
  fromPath: string
  toPath: string
}

interface DriveRenameMovesOutcome {
  // Pairs that were moved or skipped as rejected; neither path is processed again this round.
  settledPaths: Set<string>
  stoppedOnRejection: boolean
}

function pairPaths(moves: DriveRenameMove[]): Set<string> {
  return new Set(moves.flatMap((move) => [move.fromPath, move.toPath]))
}

// Detects local renames (a delete_remote and an upload_create with the same
// content hash) so they can go through the server move API, preserving
// version history and skipping a full re-upload. Only unambiguous 1:1 hash
// pairs are moved; anything else falls back to normal upload + delete processing.
function planRenameMoves(
  state: DriveState,
  paths: string[],
  localFiles: Record<string, { sha256: string; size_bytes: number }>,
  remoteFiles: Record<string, RemoteEntry>,
): DriveRenameMove[] {
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

  const moves: DriveRenameMove[] = []
  for (const [sha, fromPaths] of deletesBySha) {
    const toPaths = createsBySha.get(sha)
    if (fromPaths.length !== 1 || toPaths === undefined || toPaths.length !== 1) continue
    moves.push({ fromPath: fromPaths[0]!, toPath: toPaths[0]! })
  }
  return moves
}

// A rejected move never falls back to upload + delete and never retries with a
// fresh confirmation. On a delta view it stops so the caller can confirm with a
// full manifest; otherwise the pair is skipped for this round as a path error.
async function applyRenameMoves(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  moves: DriveRenameMove[]
  localFiles: Record<string, { sha256: string; size_bytes: number }>
  summary: DriveSyncSummary
  clock: DriveClock
  debug: DriveDebugLogger
  stopOnRejection: boolean
  onStateChange: (state: DriveState) => void
  onMoveSettled: () => void
}): Promise<DriveRenameMovesOutcome> {
  const { root, api, moves, localFiles, summary, clock, debug, stopOnRejection, onStateChange, onMoveSettled } = args
  const settledPaths = new Set<string>()
  if (api.moveFile === undefined) return { settledPaths, stoppedOnRejection: false }

  let state = args.state
  for (const { fromPath, toPath } of moves) {
    const entry = state.entries[fromPath]
    const local = localFiles[toPath]
    if (entry === undefined || local === undefined) continue
    let moved: Awaited<ReturnType<NonNullable<DriveSyncApi["moveFile"]>>>
    try {
      moved = await api.moveFile(state.library_id, fromPath, toPath, entry.entry_version, entry.entry_id)
    } catch (error) {
      if (isRetryableDriveFailure(error) || isDriveAuthFailure(error)) throw error
      const status = structuredField(error, "status")
      const code = structuredField(error, "code")
      debug.log("move_rejected", {
        from_path: fromPath,
        to_path: toPath,
        entry_id: entry.entry_id,
        expected_entry_version: entry.entry_version,
        ...(typeof status === "number" ? { status } : {}),
        ...(typeof code === "string" ? { code } : {}),
        action: stopOnRejection ? "refetch_full_manifest" : "skip_pair",
      })
      if (stopOnRejection) return { settledPaths, stoppedOnRejection: true }
      settledPaths.add(fromPath)
      settledPaths.add(toPath)
      await recordDrivePathError(summary, undefined, toPath, error, {
        appendPathResult: true,
        debug,
        op: "move",
        pathError: {
          path: toPath,
          code: typeof code === "string" ? code : "DRIVE_PATH_ERROR",
          message: `move from ${fromPath} rejected (${typeof status === "number" ? `HTTP ${status}` : errorMessage(error)})`,
          retryable: false,
        },
      })
      onMoveSettled()
      continue
    }
    const nextState = cloneDriveState(state)
    delete nextState.entries[fromPath]
    delete nextState.conflicts[fromPath]
    nextState.entries[toPath] = stateEntryFromRemote(moved.entry, local.sha256, clock)
    delete nextState.conflicts[toPath]
    await writeDriveState(root, nextState, clock)
    state = nextState
    onStateChange(nextState)
    settledPaths.add(fromPath)
    settledPaths.add(toPath)
    summary.paths.push({ path: toPath, action: "move" })
    debug.log("decision", { path: toPath, action: "move", from_path: fromPath })
    onMoveSettled()
  }
  return { settledPaths, stoppedOnRejection: false }
}

function isCurrentUploadRejection(rejection: DriveUploadRejection, scanned: DriveScanCacheEntry | undefined): boolean {
  return (
    scanned?.mtime_ms === rejection.mtime_ms &&
    scanned.size_bytes === rejection.size_bytes &&
    scanned.sha256 === rejection.sha256 &&
    rejection.cli_version === VERSION
  )
}

function structuredField(error: unknown, key: "status" | "code"): unknown {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined
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

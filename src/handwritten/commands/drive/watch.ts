import { Command } from "commander"
import chokidar from "chokidar"
import { watch as fsWatch } from "node:fs"
import { basename, relative, resolve } from "node:path"
import { loadRealtimeAuthHeaders } from "../../auth/load-sdk-client.js"
import { render, shouldOutputJson } from "../../output/render.js"
import { createDriveDebugLogger, noopDriveDebugLogger, type DriveDebugLogger } from "./debug-log.js"
import { createDriveRealtimeSource } from "./realtime.js"
import { isInternalSyncArtifactName } from "./scanner.js"
import { DRIVE_DIR, ensureDriveRealtimeState, readDriveState, writeDriveRealtimeState } from "./state.js"
import { runDriveSyncOnce, type DriveSyncProgress, type DriveSyncSummary } from "./sync.js"
import { DriveRetryableSyncError, classifyDriveRetry, isDriveAuthFailure } from "./retry.js"

export interface DriveWatchSource {
  onChange(handler: (path?: string) => void): void
  close(): Promise<void>
}

export type DriveRealtimeReconnectReason = "auth" | "network"

export interface DriveRealtimeSource {
  start(handlers: {
    onConnected: () => void
    onEvent: (event: {
      debounce_ms?: number
      immediate?: boolean
      cursor?: string
      path?: string
      reason?: string
    }) => void
    onReconnect: (delayMs: number, error: string, reason: DriveRealtimeReconnectReason) => void
    onAuthFailed: (error?: string, reason?: string) => void
    onWarning?: (warning: string) => void
  }): Promise<void>
  close(): Promise<void>
}

export interface DriveWatchTimerHandle {
  cancel(): void
}

export interface DriveWatchTimer {
  now(): Date
  schedule(delayMs: number, callback: () => void): DriveWatchTimerHandle
}

export interface DriveWatchOptions {
  source?: DriveWatchSource
  realtimeSource?: DriveRealtimeSource
  readState?: typeof readDriveState
  runSync?: (root: string, onProgress?: DriveSyncProgress, dirtyPaths?: string[]) => Promise<DriveSyncSummary>
  once?: boolean
  debounceMs?: number
  remoteDebounceMs?: number
  onEvent?: (event: unknown) => void
  debug?: boolean
  debugLogger?: DriveDebugLogger
  timer?: DriveWatchTimer
}

export async function runDriveWatch(root: string, options: DriveWatchOptions = {}): Promise<void> {
  const dbg = options.debugLogger ?? (options.debug ? createDriveDebugLogger(root) : noopDriveDebugLogger)
  const runSync =
    options.runSync ??
    ((syncRoot: string, onProgress?: DriveSyncProgress, dirtyPaths?: string[]) =>
      runDriveSyncOnce(syncRoot, undefined, undefined, onProgress, dbg, dirtyPaths === undefined ? {} : { dirtyPaths }))
  const debounceMs = options.debounceMs ?? 500
  const remoteDebounceMs = options.remoteDebounceMs ?? 2000
  const timer = options.timer ?? systemDriveWatchTimer
  // Watch is a long-lived event stream: json mode must emit NDJSON (one event
  // per line) so consumers can parse line-by-line instead of reassembling
  // pretty-printed multi-line JSON, which breaks past any buffer limit.
  const emit =
    options.onEvent ??
    ((event: unknown) => {
      if (shouldOutputJson()) {
        process.stdout.write(`${JSON.stringify(event)}\n`)
        return
      }
      render({ kind: "drive_watch", display: { shape: "object" } }, event)
    })
  let nextTrigger = "initial"
  let fullReconciliationRequired = true
  // Paths touched by fs events since the last successful sync. Local-trigger
  // syncs re-stat only these; other triggers (initial/retry/remote) do a full
  // reconciliation walk that also self-heals any missed events.
  const dirtyPaths = new Set<string>()
  let debounceTimer: DriveWatchTimerHandle | undefined
  let debounceDeadlineMs: number | undefined
  let retryTimer: DriveWatchTimerHandle | undefined
  let resolveRetryTimer: (() => void) | undefined
  let running = false
  let rerunRequested = false
  let backoffMs = 1000
  let stopped = false
  let stopWatch: (() => void) | undefined
  let stopError: unknown
  let cleanupSignalListeners = () => {}

  async function requestSync(): Promise<void> {
    if (stopped) return
    if (running) {
      rerunRequested = true
      return
    }
    running = true
    try {
      do {
        rerunRequested = false
        try {
          // A large first upload can run for minutes; without this the app
          // shows a stale badge and users assume sync never started.
          emit({ kind: "drive_sync_start" })
          dbg.log("sync_start", { trigger: nextTrigger })
          const startedAtMs = Date.now()
          const dirtySnapshot = fullReconciliationRequired ? undefined : [...dirtyPaths]
          fullReconciliationRequired = false
          dirtyPaths.clear()
          const summary = await runSync(
            root,
            (processed, total) => {
              emit({ kind: "drive_sync_progress", processed, total })
            },
            dirtySnapshot,
          )
          emit({ kind: "drive_sync_once", ...summary })
          dbg.log("sync_end", {
            duration_ms: Date.now() - startedAtMs,
            uploaded: summary.uploaded,
            downloaded: summary.downloaded,
            deleted: summary.deleted,
            merged: summary.merged,
            unchanged: summary.unchanged,
            conflicts: summary.conflicts,
            errors: summary.errors,
          })
          backoffMs = 1000
        } catch (error) {
          if (isAuthError(error) || isFatalWatchError(error)) throw error
          const retry = classifyDriveRetry(error, backoffMs)
          if (retry === undefined) throw error
          const context = error instanceof DriveRetryableSyncError ? error : undefined
          const retryEvent = {
            kind: "drive_watch_retry",
            reason: retry.reason,
            delay_ms: retry.delayMs,
            ...(context?.remaining === undefined ? {} : { remaining: context.remaining }),
            error: errorMessage(error),
            ...(context === undefined || context.pathErrors.length === 0 ? {} : { path_errors: context.pathErrors }),
          }
          emit(retryEvent)
          dbg.log("retry", {
            reason: retry.reason,
            delay_ms: retry.delayMs,
            error: errorMessage(error),
            ...(context?.remaining === undefined ? {} : { remaining: context.remaining }),
            ...(context === undefined ? {} : { path_error_count: context.pathErrors.length }),
          })
          nextTrigger = "retry"
          fullReconciliationRequired = true
          if (stopped) return
          await waitForManagedTimer(retry.delayMs)
          if (stopped) return
          backoffMs = Math.min(backoffMs * 2, 60_000)
          nextTrigger = "retry"
          rerunRequested = true
        }
      } while (rerunRequested && !stopped)
    } finally {
      running = false
    }
  }

  function clearDebounceTimer(): void {
    if (debounceTimer === undefined) return
    debounceTimer.cancel()
    debounceTimer = undefined
    debounceDeadlineMs = undefined
  }

  function scheduleSync(delayMs: number, trigger: string): void {
    nextTrigger = trigger
    if (trigger !== "local") fullReconciliationRequired = true
    if (running) {
      rerunRequested = true
      return
    }
    if (delayMs <= 0) {
      clearDebounceTimer()
      requestSync().catch(stopWithError)
      return
    }
    const deadlineMs = timer.now().getTime() + delayMs
    if (debounceTimer !== undefined && debounceDeadlineMs !== undefined && debounceDeadlineMs <= deadlineMs) return
    clearDebounceTimer()
    debounceDeadlineMs = deadlineMs
    debounceTimer = timer.schedule(delayMs, () => {
      debounceTimer = undefined
      debounceDeadlineMs = undefined
      requestSync().catch(stopWithError)
    })
  }

  function clearRetryTimer(): void {
    if (retryTimer === undefined) return
    retryTimer.cancel()
    retryTimer = undefined
    resolveRetryTimer?.()
    resolveRetryTimer = undefined
  }

  function waitForManagedTimer(ms: number): Promise<void> {
    clearRetryTimer()
    return new Promise<void>((resolve) => {
      resolveRetryTimer = resolve
      retryTimer = timer.schedule(ms, () => {
        retryTimer = undefined
        resolveRetryTimer = undefined
        resolve()
      })
    })
  }

  function stopWithError(error: unknown): void {
    stopError = error
    stopped = true
    clearDebounceTimer()
    clearRetryTimer()
    stopWatch?.()
  }

  let source: DriveWatchSource | undefined
  let realtimeSource: DriveRealtimeSource | undefined
  try {
    let state = await (options.readState ?? readDriveState)(root)
    realtimeSource = options.once ? undefined : options.realtimeSource
    if (!options.once && realtimeSource === undefined) {
      state = await ensureDriveRealtimeState(root)
      const verifyPath = `/drive/libraries/${encodeURIComponent(state.library_id)}`
      const { baseUrl } = await loadRealtimeAuthHeaders({ verifyPath })
      const realtime = state.realtime
      if (realtime === undefined) {
        throw new Error("drive realtime state is required")
      }
      realtimeSource = createDriveRealtimeSource({
        baseUrl,
        // Tokens expire while watching; resolve fresh headers on every
        // (re)connect so an idle drop cannot loop on a stale snapshot.
        headers: async () => (await loadRealtimeAuthHeaders({ verifyPath })).headers,
        libraryId: state.library_id,
        realtime,
        writeRealtimeState: (next) => writeDriveRealtimeState(root, next),
      })
    }
    source = options.source ?? createDefaultWatchSource(root)
    source.onChange((path) => {
      if (path === undefined) {
        fullReconciliationRequired = true
        dbg.log("fs_event", { full_reconciliation: true })
        scheduleSync(debounceMs, "unknown")
        return
      }
      const drivePath = relative(root, path).replace(/\\/g, "/")
      if (drivePath === `${DRIVE_DIR}/ignore`) {
        fullReconciliationRequired = true
        dbg.log("fs_event", { path: drivePath, full_reconciliation: true })
        scheduleSync(debounceMs, "ignore")
        return
      }
      if (isDriveInternalPath(root, path)) return
      // Download/backup/merge temp files are our own writes; reacting to them
      // would chain an extra sync after every applied remote change.
      if (isInternalSyncArtifactName(basename(path))) return
      dirtyPaths.add(drivePath)
      dbg.log("fs_event", { path: drivePath })
      scheduleSync(debounceMs, "local")
    })

    emit({ kind: "drive_watch_started", root, library_id: state.library_id })
    realtimeSource
      ?.start({
        onConnected() {
          emit({ kind: "drive_realtime_connected", library_id: state.library_id })
          dbg.log("realtime_connected", {})
        },
        onEvent(event) {
          emit(realtimeEvent(event))
          dbg.log("realtime_event", { ...event })
          if (event.immediate) {
            scheduleSync(0, "remote")
            return
          }
          scheduleSync(event.debounce_ms ?? remoteDebounceMs, "remote")
        },
        onReconnect(delayMs, error, reason) {
          emit({ kind: "drive_realtime_reconnecting", delay_ms: delayMs, error, reason })
          dbg.log("realtime_reconnecting", { delay_ms: delayMs, error, reason })
        },
        onAuthFailed(error, reason) {
          // Reaching here means the server refused to rotate the refresh token,
          // so this is never recoverable by retrying.
          const detail = {
            error: error ?? "auth failed",
            recoverable: false as const,
            ...(reason === undefined ? {} : { reason }),
          }
          emit({ kind: "drive_realtime_auth_failed", ...detail })
          dbg.log("realtime_auth_failed", { ...detail })
        },
        onWarning(warning) {
          emit({ kind: "drive_realtime_warning", warning })
          dbg.log("realtime_warning", { warning })
        },
      })
      .catch(stopWithError)
    await requestSync()
    if (options.once) return
    if (stopError !== undefined) throw stopError
    await waitForStopSignal((stop, removeListeners) => {
      stopWatch = stop
      cleanupSignalListeners = removeListeners
    })
    if (stopError !== undefined) throw stopError
  } finally {
    stopped = true
    clearDebounceTimer()
    clearRetryTimer()
    cleanupSignalListeners()
    await Promise.all([source?.close(), realtimeSource?.close()])
  }
}

export function driveWatchCommand(options: DriveWatchOptions = {}): Command {
  return new Command("watch")
    .description("Watch a bound Drive folder and sync local changes")
    .argument("[path]", "local folder path", ".")
    .option("--debug", "append debug NDJSON events to <folder>/.wspc-drive/debug.log")
    .action(async (path: string, flags: { debug?: boolean }) => {
      const debug = options.debug ?? (flags.debug === true || process.env.WSPC_DRIVE_DEBUG === "1")
      await runDriveWatch(resolve(path), { ...options, debug })
    })
}

export function createDefaultWatchSource(root: string): DriveWatchSource {
  // Windows refuses to rename a directory while any handle is open beneath
  // it, and chokidar keeps one fs.watch handle per subdirectory, so every
  // folder rename in the synced tree failed with EPERM (e.g. from Obsidian).
  // A single recursive root watch only pins the root itself.
  return process.platform === "win32" ? createNativeRecursiveSource(root) : createChokidarSource(root)
}

export function createNativeRecursiveSource(root: string, watch = fsWatch): DriveWatchSource {
  const handlers: Array<(path?: string) => void> = []
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const path = filename === null ? undefined : resolve(root, filename.toString())
    for (const handler of handlers) handler(path)
  })
  // A watcher error must not crash the whole watch loop; realtime events
  // still trigger syncs even if local watching degrades.
  watcher.on("error", () => {})
  return {
    onChange(handler) {
      handlers.push(handler)
    },
    async close() {
      watcher.close()
    },
  }
}

export function createChokidarSource(root: string, watch = chokidar.watch): DriveWatchSource {
  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (path) => shouldIgnoreDriveWatchPath(root, path),
  })
  return {
    onChange(handler) {
      watcher.on("all", (_event, path) => handler(path))
    },
    async close() {
      await watcher.close()
    },
  }
}

function shouldIgnoreDriveWatchPath(root: string, path: string): boolean {
  if (!isDriveInternalPath(root, path)) return false
  const drivePath = relative(root, path).replace(/\\/g, "/")
  return drivePath !== DRIVE_DIR && drivePath !== `${DRIVE_DIR}/ignore`
}

function isDriveInternalPath(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === DRIVE_DIR || rel.startsWith(`${DRIVE_DIR}/`) || rel.startsWith(`${DRIVE_DIR}\\`)
}

function isAuthError(error: unknown): boolean {
  if (isDriveAuthFailure(error)) return true
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  const message = errorMessage(error)
  return code === "WSPC_AUTH_EXPIRED" || /\b(401|403|auth|authorization)\b/i.test(message)
}

function isFatalWatchError(error: unknown): boolean {
  return /unsupported .*state\.json schema|sync lock already exists/i.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const systemDriveWatchTimer: DriveWatchTimer = {
  now: () => new Date(),
  schedule(delayMs, callback) {
    const handle = setTimeout(callback, delayMs)
    return { cancel: () => clearTimeout(handle) }
  },
}

function realtimeEvent(event: { cursor?: string; path?: string; reason?: string }): unknown {
  return {
    kind: "drive_realtime_event",
    message: "remote update received; syncing",
    ...(event.path === undefined ? {} : { path: event.path }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
  }
}

function waitForStopSignal(onRegistered: (stop: () => void, cleanup: () => void) => void): Promise<void> {
  return new Promise<void>((resolveStop) => {
    const stop = () => resolveStop()
    const cleanup = () => {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
    }
    onRegistered(stop, cleanup)
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
}

import { Command } from "commander"
import chokidar from "chokidar"
import { watch as fsWatch } from "node:fs"
import { relative, resolve } from "node:path"
import { loadRealtimeAuthHeaders } from "../../auth/load-sdk-client.js"
import { render } from "../../output/render.js"
import { createDriveRealtimeSource } from "./realtime.js"
import { DRIVE_DIR, ensureDriveRealtimeState, readDriveState, writeDriveRealtimeState } from "./state.js"
import { runDriveSyncOnce, type DriveSyncSummary } from "./sync.js"

export interface DriveWatchSource {
  onChange(handler: (path: string) => void): void
  close(): Promise<void>
}

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
    onReconnect: (delayMs: number, error: string) => void
    onAuthFailed: (error?: string) => void
    onWarning?: (warning: string) => void
  }): Promise<void>
  close(): Promise<void>
}

export interface DriveWatchOptions {
  source?: DriveWatchSource
  realtimeSource?: DriveRealtimeSource
  readState?: typeof readDriveState
  runSync?: (root: string) => Promise<DriveSyncSummary>
  once?: boolean
  debounceMs?: number
  remoteDebounceMs?: number
  onEvent?: (event: unknown) => void
}

export async function runDriveWatch(root: string, options: DriveWatchOptions = {}): Promise<void> {
  const runSync = options.runSync ?? runDriveSyncOnce
  const debounceMs = options.debounceMs ?? 500
  const remoteDebounceMs = options.remoteDebounceMs ?? 2000
  const emit = options.onEvent ?? ((event) => render({ kind: "drive_watch", display: { shape: "object" } }, event))
  let debounceTimer: NodeJS.Timeout | undefined
  let debounceDeadlineMs: number | undefined
  let retryTimer: NodeJS.Timeout | undefined
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
          const summary = await runSync(root)
          emit({ kind: "drive_sync_once", ...summary })
          backoffMs = 1000
        } catch (error) {
          if (isAuthError(error) || isFatalWatchError(error) || !isRetryableWatchError(error)) throw error
          emit({ kind: "drive_watch_retry", delay_ms: backoffMs, error: errorMessage(error) })
          if (stopped) return
          await waitForManagedTimer(backoffMs)
          if (stopped) return
          backoffMs = Math.min(backoffMs * 2, 60_000)
          rerunRequested = true
        }
      } while (rerunRequested && !stopped)
    } finally {
      running = false
    }
  }

  function clearDebounceTimer(): void {
    if (debounceTimer === undefined) return
    clearTimeout(debounceTimer)
    debounceTimer = undefined
    debounceDeadlineMs = undefined
  }

  function scheduleSync(delayMs: number): void {
    if (running) {
      rerunRequested = true
      return
    }
    if (delayMs <= 0) {
      clearDebounceTimer()
      requestSync().catch(stopWithError)
      return
    }
    const deadlineMs = Date.now() + delayMs
    if (debounceTimer !== undefined && debounceDeadlineMs !== undefined && debounceDeadlineMs <= deadlineMs) return
    clearDebounceTimer()
    debounceDeadlineMs = deadlineMs
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      debounceDeadlineMs = undefined
      requestSync().catch(stopWithError)
    }, delayMs)
  }

  function clearRetryTimer(): void {
    if (retryTimer === undefined) return
    clearTimeout(retryTimer)
    retryTimer = undefined
    resolveRetryTimer?.()
    resolveRetryTimer = undefined
  }

  function waitForManagedTimer(ms: number): Promise<void> {
    clearRetryTimer()
    return new Promise<void>((resolve) => {
      resolveRetryTimer = resolve
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        resolveRetryTimer = undefined
        resolve()
      }, ms)
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
      if (isDriveInternalPath(root, path)) return
      scheduleSync(debounceMs)
    })

    emit({ kind: "drive_watch_started", root, library_id: state.library_id })
    realtimeSource
      ?.start({
        onConnected() {
          emit({ kind: "drive_realtime_connected", library_id: state.library_id })
        },
        onEvent(event) {
          emit(realtimeEvent(event))
          if (event.immediate) {
            scheduleSync(0)
            return
          }
          scheduleSync(event.debounce_ms ?? remoteDebounceMs)
        },
        onReconnect(delayMs, error) {
          emit({ kind: "drive_realtime_reconnecting", delay_ms: delayMs, error })
        },
        onAuthFailed(error) {
          emit({ kind: "drive_realtime_auth_failed", error: error ?? "auth failed" })
        },
        onWarning(warning) {
          emit({ kind: "drive_realtime_warning", warning })
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
    .action(async (path: string) => {
      await runDriveWatch(resolve(path), options)
    })
}

export function createDefaultWatchSource(root: string): DriveWatchSource {
  // Windows refuses to rename a directory while any handle is open beneath
  // it, and chokidar keeps one fs.watch handle per subdirectory, so every
  // folder rename in the synced tree failed with EPERM (e.g. from Obsidian).
  // A single recursive root watch only pins the root itself.
  return process.platform === "win32" ? createNativeRecursiveSource(root) : createChokidarSource(root)
}

function createNativeRecursiveSource(root: string): DriveWatchSource {
  const handlers: Array<(path: string) => void> = []
  const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
    if (filename === null) return
    const path = resolve(root, filename.toString())
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

function createChokidarSource(root: string): DriveWatchSource {
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (path) => isDriveInternalPath(root, path),
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

function isDriveInternalPath(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === DRIVE_DIR || rel.startsWith(`${DRIVE_DIR}/`) || rel.startsWith(`${DRIVE_DIR}\\`)
}

function isAuthError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  const message = errorMessage(error)
  return code === "WSPC_AUTH_EXPIRED" || /\b(401|403|auth|authorization)\b/i.test(message)
}

function isFatalWatchError(error: unknown): boolean {
  return /unsupported .*state\.json schema|sync lock already exists/i.test(errorMessage(error))
}

function isRetryableWatchError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined
  const message = errorMessage(error)
  return status === 429 || (typeof status === "number" && status >= 500) || /\b(429|5\d\d|network|temporary|fetch)\b/i.test(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

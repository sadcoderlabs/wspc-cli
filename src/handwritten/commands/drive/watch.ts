import { Command } from "commander"
import chokidar from "chokidar"
import { relative, resolve } from "node:path"
import { render } from "../../output/render.js"
import { DRIVE_DIR, readDriveState } from "./state.js"
import { runDriveSyncOnce, type DriveSyncSummary } from "./sync.js"

export interface DriveWatchSource {
  onChange(handler: (path: string) => void): void
  close(): Promise<void>
}

export interface DriveWatchOptions {
  source?: DriveWatchSource
  readState?: typeof readDriveState
  runSync?: (root: string) => Promise<DriveSyncSummary>
  once?: boolean
  debounceMs?: number
  sleep?: (ms: number) => Promise<void>
  onEvent?: (event: unknown) => void
}

export async function runDriveWatch(root: string, options: DriveWatchOptions = {}): Promise<void> {
  const runSync = options.runSync ?? runDriveSyncOnce
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)))
  const debounceMs = options.debounceMs ?? 500
  const source = options.source ?? createChokidarSource(root)
  const emit = options.onEvent ?? ((event) => render({ kind: "drive_watch", display: { shape: "object" } }, event))
  let timer: NodeJS.Timeout | undefined
  let running = false
  let rerunRequested = false
  let backoffMs = 1000

  async function requestSync(): Promise<void> {
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
          if (isAuthError(error) || isFatalWatchError(error)) throw error
          emit({ kind: "drive_watch_retry", delay_ms: backoffMs, error: errorMessage(error) })
          await sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, 60_000)
          rerunRequested = true
        }
      } while (rerunRequested)
    } finally {
      running = false
    }
  }

  source.onChange((path) => {
    if (isDriveInternalPath(root, path)) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void requestSync(), debounceMs)
  })

  const state = await (options.readState ?? readDriveState)(root)
  emit({ kind: "drive_watch_started", root, library_id: state.library_id })
  await requestSync()
  if (options.once) {
    await source.close()
    return
  }
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", resolveStop)
    process.once("SIGTERM", resolveStop)
  })
  await source.close()
}

export function driveWatchCommand(options: DriveWatchOptions = {}): Command {
  return new Command("watch")
    .description("Watch a bound Drive folder and sync local changes")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string) => {
      await runDriveWatch(resolve(path), options)
    })
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { DateTime } from "luxon"
import { driveIsoTimestamp, type DriveClock } from "./clock.js"

export const DRIVE_DIR = ".wspc-drive"
export const STATE_FILE = "state.json"
const STALE_LOCK_MS = 10 * 60 * 1000

export interface DriveStateEntry {
  entry_id: string
  entry_version: number
  size_bytes: number
  last_synced_at: string
  status: "synced"
  current_version_id?: string
  content_sha256?: string
  last_local_sha256?: string
}

export interface DriveConflict {
  detected_at: string
  reason: string
  type?: "edit_edit" | "create_create" | "delete_edit" | "edit_delete"
  strategy?: "clean_merge" | "conflict_copy" | "record_only"
  base_version_id?: string
  remote_entry_version?: number
  remote_version_id?: string
  conflict_paths?: string[]
}

export interface DriveRealtimeState {
  client_id: string
  last_cursor?: string
  last_connected_at?: string
  last_event_at?: string
}

export interface DriveScanCacheEntry {
  mtime_ms: number
  size_bytes: number
  sha256: string
}

export interface DriveState {
  schema_version: 1
  library_id: string
  created_at: string
  updated_at: string
  entries: Record<string, DriveStateEntry>
  conflicts: Record<string, DriveConflict>
  realtime?: DriveRealtimeState
  scan_cache?: Record<string, DriveScanCacheEntry>
  // Latest manifest cursor seen; enables since_cursor delta fetches.
  manifest_cursor?: string
}

export function statePath(root: string): string {
  return join(root, DRIVE_DIR, STATE_FILE)
}

export async function readDriveState(root: string): Promise<DriveState> {
  const buf = await readFile(statePath(root), "utf8")
  const parsed = JSON.parse(buf)
  if (!isValidDriveState(parsed)) {
    throw new Error("unsupported .wspc-drive/state.json schema")
  }
  return parsed
}

export async function writeDriveState(root: string, state: DriveState, clock?: DriveClock): Promise<void> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const tmp = join(root, DRIVE_DIR, `state.json.tmp-${process.pid}-${randomUUID()}`)
  const snapshot = JSON.stringify(
    {
      ...state,
      updated_at: driveIsoTimestamp(clock),
    },
    null,
    2,
  ) + "\n"
  const fullPath = statePath(root)
  try {
    await writeFile(tmp, snapshot, { mode: 0o600 })
    // Open "r+" not "r": Windows FlushFileBuffers (fsync) rejects a
    // read-only handle with EPERM, so the sync needs write access.
    const fh = await open(tmp, "r+")
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, fullPath)
  } finally {
    await rm(tmp, { force: true })
  }
}

export async function initDriveState(root: string, libraryId: string, clock?: DriveClock): Promise<DriveState> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  try {
    const existing = await readDriveState(root)
    if (existing.library_id !== libraryId) {
      throw new Error(`folder already bound to ${existing.library_id}`)
    }
    return existing
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  const now = driveIsoTimestamp(clock)
  const state: DriveState = {
    schema_version: 1,
    library_id: libraryId,
    created_at: now,
    updated_at: now,
    entries: {},
    conflicts: {},
  }
  await writeDriveState(root, state, clock)
  return state
}

export async function ensureDriveRealtimeState(root: string): Promise<DriveState> {
  return withDriveLock(root, async () => {
    const state = await readDriveState(root)
    if (state.realtime?.client_id !== undefined) {
      return state
    }
    const next: DriveState = {
      ...state,
      realtime: {
        ...state.realtime,
        client_id: `drvcli_${randomUUID().replace(/-/g, "")}`,
      },
    }
    await writeDriveState(root, next)
    return next
  })
}

export interface DriveLockOptions {
  // A sync holds the lock for the whole upload cycle. Realtime cursor
  // persistence is a tiny best-effort write that should wait it out rather than
  // surface a spurious warning, so it opts into a bounded retry.
  retries?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

// Enough attempts to outlast a normal sync cycle (~2s) before giving up.
const REALTIME_LOCK_RETRIES = 20
const REALTIME_LOCK_RETRY_DELAY_MS = 100

export async function writeDriveRealtimeState(
  root: string,
  realtime: DriveRealtimeState,
  lockOptions: DriveLockOptions = { retries: REALTIME_LOCK_RETRIES, retryDelayMs: REALTIME_LOCK_RETRY_DELAY_MS },
): Promise<void> {
  await withDriveLock(root, async () => {
    const current = await readDriveState(root)
    await writeDriveState(root, { ...current, realtime })
  }, lockOptions)
}

export async function withDriveLock<T>(root: string, fn: () => Promise<T>, options: DriveLockOptions = {}): Promise<T> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const lockFile = join(root, DRIVE_DIR, "sync.lock")
  const retries = options.retries ?? 0
  const retryDelayMs = options.retryDelayMs ?? 100
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const acquire = async () => {
    const handle = await open(lockFile, "wx")
    await handle.writeFile(String(process.pid))
    return handle
  }
  let fh: Awaited<ReturnType<typeof acquire>> | undefined
  for (let attempt = 0; ; attempt += 1) {
    try {
      fh = await acquire()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (await isLockAbandoned(lockFile)) {
        await rm(lockFile, { force: true })
        continue
      }
      if (attempt < retries) {
        await sleep(retryDelayMs)
        continue
      }
      throw Object.assign(new Error("sync lock already exists"), { code: "WSPC_DRIVE_LOCK_HELD" })
    }
  }
  try {
    return await fn()
  } finally {
    await fh?.close().catch(() => {})
    await rm(lockFile, { force: true }).catch(() => {})
  }
}

// A lock is abandoned when its owner process is gone (a force-killed watch on
// Windows never runs the finally cleanup), or, for locks without a readable
// pid, when its mtime is older than STALE_LOCK_MS.
async function isLockAbandoned(lockFile: string): Promise<boolean> {
  const pid = await readLockPid(lockFile)
  if (pid !== undefined && !isProcessAlive(pid)) return true
  const lockStat = await stat(lockFile).catch((statError) => {
    if ((statError as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw statError
  })
  return lockStat === undefined || Date.now() - lockStat.mtimeMs > STALE_LOCK_MS
}

async function readLockPid(lockFile: string): Promise<number | undefined> {
  const text = await readFile(lockFile, "utf8").catch(() => undefined)
  if (text === undefined || !/^\d+$/.test(text.trim())) return undefined
  return Number(text.trim())
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but is not ours; only ESRCH proves death.
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDriveStateEntry(value: unknown): value is DriveStateEntry {
  return (
    isRecord(value) &&
    typeof value.entry_id === "string" &&
    typeof value.entry_version === "number" &&
    typeof value.size_bytes === "number" &&
    typeof value.last_synced_at === "string" &&
    value.status === "synced" &&
    (value.current_version_id === undefined || typeof value.current_version_id === "string") &&
    (value.content_sha256 === undefined || typeof value.content_sha256 === "string") &&
    (value.last_local_sha256 === undefined || typeof value.last_local_sha256 === "string")
  )
}

function isDriveConflict(value: unknown): value is DriveConflict {
  return (
    isRecord(value) &&
    typeof value.detected_at === "string" &&
    typeof value.reason === "string" &&
    (
      value.type === undefined ||
      value.type === "edit_edit" ||
      value.type === "create_create" ||
      value.type === "delete_edit" ||
      value.type === "edit_delete"
    ) &&
    (
      value.strategy === undefined ||
      value.strategy === "clean_merge" ||
      value.strategy === "conflict_copy" ||
      value.strategy === "record_only"
    ) &&
    (value.base_version_id === undefined || typeof value.base_version_id === "string") &&
    (value.remote_entry_version === undefined || typeof value.remote_entry_version === "number") &&
    (value.remote_version_id === undefined || typeof value.remote_version_id === "string") &&
    (
      value.conflict_paths === undefined ||
      (Array.isArray(value.conflict_paths) && value.conflict_paths.every((path) => typeof path === "string"))
    )
  )
}

function isDriveRealtimeState(value: unknown): value is DriveRealtimeState {
  const allowedKeys = new Set(["client_id", "last_cursor", "last_connected_at", "last_event_at"])
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    (value.client_id === undefined || (typeof value.client_id === "string" && /^drvcli_[A-Za-z0-9_-]+$/.test(value.client_id))) &&
    (value.last_cursor === undefined || typeof value.last_cursor === "string") &&
    isOptionalIsoTimestamp(value.last_connected_at) &&
    isOptionalIsoTimestamp(value.last_event_at)
  )
}

function isOptionalIsoTimestamp(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== "string") return false
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return DateTime.fromISO(value, { setZone: true }).isValid
}

function isValidDriveState(value: unknown): value is DriveState {
  if (!isRecord(value)) return false
  if (
    value.schema_version !== 1 ||
    typeof value.library_id !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    !isRecord(value.entries) ||
    !isRecord(value.conflicts) ||
    (value.realtime !== undefined && !isDriveRealtimeState(value.realtime)) ||
    (value.scan_cache !== undefined && !isRecord(value.scan_cache)) ||
    (value.manifest_cursor !== undefined && typeof value.manifest_cursor !== "string")
  ) {
    return false
  }
  for (const entry of Object.values(value.entries)) {
    if (!isDriveStateEntry(entry)) return false
  }
  for (const conflict of Object.values(value.conflicts)) {
    if (!isDriveConflict(conflict)) return false
  }
  if (value.scan_cache !== undefined) {
    for (const entry of Object.values(value.scan_cache)) {
      if (!isDriveScanCacheEntry(entry)) return false
    }
  }
  return true
}

function isDriveScanCacheEntry(value: unknown): value is DriveScanCacheEntry {
  return (
    isRecord(value) &&
    typeof value.mtime_ms === "number" &&
    typeof value.size_bytes === "number" &&
    typeof value.sha256 === "string"
  )
}

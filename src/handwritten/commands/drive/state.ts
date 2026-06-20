import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const DRIVE_DIR = ".wspc-drive"
export const STATE_FILE = "state.json"

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
  remote_entry_version?: number
  remote_version_id?: string
}

export interface DriveState {
  schema_version: 1
  library_id: string
  created_at: string
  updated_at: string
  entries: Record<string, DriveStateEntry>
  conflicts: Record<string, DriveConflict>
}

export function statePath(root: string): string {
  return join(root, DRIVE_DIR, STATE_FILE)
}

export async function readDriveState(root: string): Promise<DriveState> {
  const buf = await readFile(statePath(root), "utf8")
  const state = JSON.parse(buf) as DriveState
  if (state.schema_version !== 1 || typeof state.library_id !== "string") {
    throw new Error("unsupported .wspc-drive/state.json schema")
  }
  if (!isRecord(state.entries)) state.entries = {}
  if (!isRecord(state.conflicts)) state.conflicts = {}
  return state
}

export async function writeDriveState(root: string, state: DriveState): Promise<void> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const tmp = join(root, DRIVE_DIR, `state.json.tmp-${process.pid}-${Date.now()}`)
  const snapshot = JSON.stringify(
    {
      ...state,
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n"
  const fullPath = statePath(root)
  await writeFile(tmp, snapshot, { mode: 0o600 })
  const fh = await open(tmp, "r")
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, fullPath)
}

export async function initDriveState(root: string, libraryId: string): Promise<DriveState> {
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
  const now = new Date().toISOString()
  const state: DriveState = {
    schema_version: 1,
    library_id: libraryId,
    created_at: now,
    updated_at: now,
    entries: {},
    conflicts: {},
  }
  await writeDriveState(root, state)
  return state
}

export async function withDriveLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const lockFile = join(root, DRIVE_DIR, "sync.lock")
  const fh = await open(lockFile, "wx").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("sync lock already exists")
    }
    throw error
  })
  try {
    return await fn()
  } finally {
    await fh.close().catch(() => {})
    await rm(lockFile, { force: true })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

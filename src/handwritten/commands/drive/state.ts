import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
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
  type?: "edit_edit" | "create_create" | "delete_edit" | "edit_delete"
  strategy?: "clean_merge" | "conflict_copy" | "record_only"
  base_version_id?: string
  remote_entry_version?: number
  remote_version_id?: string
  conflict_paths?: string[]
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
  const parsed = JSON.parse(buf)
  if (!isValidDriveState(parsed)) {
    throw new Error("unsupported .wspc-drive/state.json schema")
  }
  return parsed
}

export async function writeDriveState(root: string, state: DriveState): Promise<void> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const tmp = join(root, DRIVE_DIR, `state.json.tmp-${process.pid}-${randomUUID()}`)
  const snapshot = JSON.stringify(
    {
      ...state,
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n"
  const fullPath = statePath(root)
  try {
    await writeFile(tmp, snapshot, { mode: 0o600 })
    const fh = await open(tmp, "r")
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
    await rm(lockFile, { force: true }).catch(() => {})
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

function isValidDriveState(value: unknown): value is DriveState {
  if (!isRecord(value)) return false
  if (
    value.schema_version !== 1 ||
    typeof value.library_id !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    !isRecord(value.entries) ||
    !isRecord(value.conflicts)
  ) {
    return false
  }
  for (const entry of Object.values(value.entries)) {
    if (!isDriveStateEntry(entry)) return false
  }
  for (const conflict of Object.values(value.conflicts)) {
    if (!isDriveConflict(conflict)) return false
  }
  return true
}

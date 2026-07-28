import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { type Dirent, type Stats } from "node:fs"
import { open, readdir, lstat } from "node:fs/promises"
import { isAbsolute, join, posix as pathPosix, relative, resolve, sep } from "node:path"
import type { DriveExcludeRules } from "./exclude-rules.js"
import { DRIVE_DIR } from "./state.js"
import { validateDrivePath } from "./path-policy.js"

export interface DriveFileEntry {
  size_bytes: number
  sha256: string
}

export interface ScanCacheEntry {
  mtime_ms: number
  size_bytes: number
  sha256: string
}

export interface ScanDriveFilesOptions {
  onPathError?: (path: string, error: unknown) => void | Promise<void>
  // Hash cache: entries whose mtime+size match are not re-read.
  cache?: Record<string, ScanCacheEntry>
  onCacheUpdate?: (path: string, entry: ScanCacheEntry) => void
  // Scan only this subtree instead of the whole root (drive path, "" = root).
  startDrivePath?: string
  excludeRules?: DriveExcludeRules
}

interface AcceptedScanEntry {
  file: DriveFileEntry
  cache: ScanCacheEntry
}

interface ScanCandidate {
  path: string
  entry: AcceptedScanEntry
}

export async function scanDriveFiles(root: string, options: ScanDriveFilesOptions = {}): Promise<Record<string, DriveFileEntry>> {
  const accepted = await scanDriveEntries(root, options)
  const files: Record<string, DriveFileEntry> = {}
  for (const [path, entry] of Object.entries(accepted)) {
    options.onCacheUpdate?.(path, entry.cache)
    files[path] = entry.file
  }
  return files
}

async function scanDriveEntries(
  root: string,
  options: ScanDriveFilesOptions,
): Promise<Record<string, AcceptedScanEntry>> {
  const candidates: ScanCandidate[] = []
  const startDrivePath = options.startDrivePath ?? ""
  await walk(startDrivePath === "" ? root : join(root, ...startDrivePath.split("/")), startDrivePath)
  return acceptNonCollidingScanEntries(candidates, options.onPathError)

  async function walk(currentPath: string, currentDrivePath: string): Promise<void> {
    let entries
    try {
      entries = await readdir(currentPath, { withFileTypes: true })
    } catch (error) {
      // The root itself failing to read must abort: an empty scan would look
      // like "everything was deleted locally" and propagate remote deletes.
      // A vanished subtree start is fine: it just scans as empty.
      if (currentDrivePath === startDrivePath && startDrivePath !== "" && isNotFoundError(error)) return
      if (currentDrivePath === "" || !isTransientScanError(error) || !options.onPathError) throw error
      await options.onPathError(currentDrivePath, error)
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (isExcludedRootEntry(currentDrivePath, entry)) {
        continue
      }
      const nextDrivePath = currentDrivePath ? `${currentDrivePath}/${entry.name}` : entry.name
      if (isInternalSyncArtifactName(entry.name)) {
        continue
      }

      try {
        validateDrivePath(nextDrivePath)
      } catch (error) {
        if (!options.onPathError) throw error
        await options.onPathError(nextDrivePath, error)
        continue
      }
      const nextPath = join(currentPath, entry.name)
      try {
        const stats = await lstat(nextPath)

        if (stats.isSymbolicLink()) {
          continue
        }

        if (stats.isDirectory()) {
          if (options.excludeRules?.matches(nextDrivePath, "directory")) continue
          await walk(nextPath, nextDrivePath)
          continue
        }

        if (!stats.isFile()) {
          continue
        }
        if (options.excludeRules?.matches(nextDrivePath, "file")) continue

        const scanned = await scanDriveFile(nextPath, nextDrivePath, stats, options.cache)
        if (scanned) candidates.push({ path: nextDrivePath, entry: scanned })
      } catch (error) {
        // Files can vanish or lock mid-scan (rename transitions, editors
        // holding locks); skip and let the next sync pass reconcile them.
        if (!isTransientScanError(error) || !options.onPathError) throw error
        await options.onPathError(nextDrivePath, error)
      }
    }
  }

  function isExcludedRootEntry(currentDrivePath: string, entry: Dirent): boolean {
    return currentDrivePath === "" && entry.name === DRIVE_DIR
  }
}

// Incremental rescan for watch mode: start from the cached full view and
// re-stat only the dirty paths (plus their subtrees for directories). Missed
// fs events self-heal on the next full scan (initial / retry triggers).
export async function rescanDriveFiles(
  root: string,
  dirtyPaths: string[],
  options: ScanDriveFilesOptions = {},
): Promise<Record<string, DriveFileEntry>> {
  const kept: Record<string, ScanCacheEntry> = {}
  for (const [path, entry] of Object.entries(options.cache ?? {})) {
    if (!options.excludeRules?.matches(path)) kept[path] = entry
  }

  for (const dirtyPath of new Set(dirtyPaths)) {
    if (dirtyPath === "" || isInternalSyncArtifactName(pathPosix.basename(dirtyPath))) continue
    removePathAndChildren(kept, dirtyPath)

    let validationError: unknown
    try {
      validateDrivePath(dirtyPath)
    } catch (error) {
      validationError = error
    }
    if (validationError !== undefined) {
      const invalidAbsPath = resolveDirtyPathInsideRoot(root, dirtyPath)
      if (invalidAbsPath !== undefined) {
        try {
          await lstat(invalidAbsPath)
        } catch (error) {
          if (isNotFoundError(error)) continue
          if (!isTransientScanError(error)) throw error
        }
      }
      if (!options.onPathError) throw validationError
      await options.onPathError(dirtyPath, validationError)
      continue
    }

    const absPath = join(root, ...dirtyPath.split("/"))
    let stats
    try {
      stats = await lstat(absPath)
    } catch (error) {
      if (isNotFoundError(error)) continue
      if (!isTransientScanError(error) || !options.onPathError) throw error
      await options.onPathError(dirtyPath, error)
      continue
    }

    if (stats.isSymbolicLink()) continue

    if (stats.isDirectory()) {
      if (options.excludeRules?.matches(dirtyPath, "directory")) continue
      const accepted = await scanDriveEntries(root, {
        ...options,
        startDrivePath: dirtyPath,
      })
      for (const [path, entry] of Object.entries(accepted)) kept[path] = entry.cache
      continue
    }

    if (!stats.isFile()) continue
    if (options.excludeRules?.matches(dirtyPath, "file")) continue

    try {
      const scanned = await scanDriveFile(absPath, dirtyPath, stats, options.cache)
      if (scanned) kept[dirtyPath] = scanned.cache
    } catch (error) {
      if (!isTransientScanError(error) || !options.onPathError) throw error
      await options.onPathError(dirtyPath, error)
    }
  }

  const candidates: ScanCandidate[] = Object.entries(kept).map(([path, cache]) => ({
    path,
    entry: {
      file: { sha256: cache.sha256, size_bytes: cache.size_bytes },
      cache,
    },
  }))
  const accepted = await acceptNonCollidingScanEntries(candidates, options.onPathError)
  const files: Record<string, DriveFileEntry> = {}
  for (const [path, entry] of Object.entries(accepted)) {
    options.onCacheUpdate?.(path, entry.cache)
    files[path] = entry.file
  }
  return files
}

async function acceptNonCollidingScanEntries(
  candidates: ScanCandidate[],
  onPathError: ScanDriveFilesOptions["onPathError"],
): Promise<Record<string, AcceptedScanEntry>> {
  const byCaseFoldedPath = new Map<string, ScanCandidate[]>()
  for (const candidate of candidates) {
    const folded = candidate.path.toLowerCase()
    const group = byCaseFoldedPath.get(folded) ?? []
    group.push(candidate)
    byCaseFoldedPath.set(folded, group)
  }

  const accepted: Record<string, AcceptedScanEntry> = {}
  for (const group of byCaseFoldedPath.values()) {
    if (group.length > 1) {
      const sorted = group.sort((left, right) => left.path.localeCompare(right.path))
      for (const candidate of sorted) {
        const error = new Error(`LOCAL_PATH_CASE_CONFLICT: ${candidate.path}`)
        if (!onPathError) throw error
        await onPathError(candidate.path, error)
      }
      continue
    }
    const [candidate] = group
    if (candidate) accepted[candidate.path] = candidate.entry
  }
  return accepted
}

async function scanDriveFile(
  absolutePath: string,
  drivePath: string,
  stats: Stats,
  cache: Record<string, ScanCacheEntry> | undefined,
): Promise<AcceptedScanEntry | undefined> {
  const cached = cache?.[drivePath]
  if (cached !== undefined && cached.mtime_ms === stats.mtimeMs && cached.size_bytes === stats.size) {
    return {
      file: { sha256: cached.sha256, size_bytes: cached.size_bytes },
      cache: cached,
    }
  }

  const digest = await hashDriveFile(absolutePath)
  if (!digest) return undefined
  return {
    file: { sha256: digest.sha256, size_bytes: digest.sizeBytes },
    cache: { mtime_ms: stats.mtimeMs, size_bytes: digest.sizeBytes, sha256: digest.sha256 },
  }
}

function resolveDirtyPathInsideRoot(root: string, dirtyPath: string): string | undefined {
  const absoluteRoot = resolve(root)
  const candidate = resolve(absoluteRoot, dirtyPath)
  const relativePath = relative(absoluteRoot, candidate)
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined
  }
  return candidate
}

function removePathAndChildren(view: Record<string, ScanCacheEntry>, path: string): void {
  delete view[path]
  const prefix = `${path}/`
  for (const key of Object.keys(view)) {
    if (key.startsWith(prefix)) delete view[key]
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

const TRANSIENT_SCAN_ERROR_CODES = new Set(["ENOENT", "EPERM", "EBUSY"])

function isTransientScanError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    TRANSIENT_SCAN_ERROR_CODES.has((error as NodeJS.ErrnoException).code as string)
  )
}

export function isInternalSyncArtifactName(name: string): boolean {
  if (!name.startsWith(".") || !name.endsWith(".tmp")) return false
  return (
    name.includes(".wspc-download-") ||
    name.includes(".wspc-backup-") ||
    name.includes(".wspc-conflict-") ||
    name.includes(".wspc-merge-")
  )
}

export type FileDigest = { sizeBytes: number; sha256: string }

export async function hashDriveFile(path: string): Promise<FileDigest | undefined> {
  const useNoFollow = fsConstants.O_NOFOLLOW !== undefined
  const fdFlags = useNoFollow ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW : fsConstants.O_RDONLY
  const fileHandle = await open(path, fdFlags)
  const hash = createHash("sha256")
  let sizeBytes = 0
  try {
    const stats = await fileHandle.stat()
    if (!stats.isFile()) {
      return undefined
    }

    if (!useNoFollow) {
      // Fallback TOCTOU check when O_NOFOLLOW is unavailable: verify the path is still the same regular file.
      const liveStats = await lstat(path)
      if (!liveStats.isFile()) {
        return undefined
      }
      if (stats.ino !== undefined && liveStats.ino !== undefined && stats.dev !== undefined && liveStats.dev !== undefined) {
        if (stats.ino !== liveStats.ino || stats.dev !== liveStats.dev) {
          return undefined
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      const stream = fileHandle.createReadStream()
      stream.on("error", reject)
      stream.on("data", (chunk: Buffer) => {
        hash.update(chunk)
        sizeBytes += chunk.length
      })
      stream.on("end", () => resolve())
    })
    return {
      sizeBytes,
      sha256: hash.digest("hex"),
    }
  } finally {
    await fileHandle.close().catch(() => {})
  }
}

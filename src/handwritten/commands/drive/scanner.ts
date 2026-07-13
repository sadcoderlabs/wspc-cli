import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { type Dirent } from "node:fs"
import { open, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
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
}

export async function scanDriveFiles(root: string, options: ScanDriveFilesOptions = {}): Promise<Record<string, DriveFileEntry>> {
  const candidates: Array<{ path: string; entry: DriveFileEntry }> = []
  const files: Record<string, DriveFileEntry> = {}
  const absRoot = root
  await walk(absRoot, "")
  await addNonCollidingFiles(candidates)
  return files

  async function walk(currentPath: string, currentDrivePath: string): Promise<void> {
    let entries
    try {
      entries = await readdir(currentPath, { withFileTypes: true })
    } catch (error) {
      // The root itself failing to read must abort: an empty scan would look
      // like "everything was deleted locally" and propagate remote deletes.
      if (currentDrivePath === "" || !isTransientScanError(error) || !options.onPathError) throw error
      await options.onPathError(currentDrivePath, error)
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (isExcludedRootEntry(currentDrivePath, entry)) {
        continue
      }
      if (isInternalSyncArtifactName(entry.name)) {
        continue
      }

      const nextDrivePath = currentDrivePath ? `${currentDrivePath}/${entry.name}` : entry.name
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
          await walk(nextPath, nextDrivePath)
          continue
        }

        if (!stats.isFile()) {
          continue
        }

        const cached = options.cache?.[nextDrivePath]
        if (cached !== undefined && cached.mtime_ms === stats.mtimeMs && cached.size_bytes === stats.size) {
          options.onCacheUpdate?.(nextDrivePath, cached)
          candidates.push({ path: nextDrivePath, entry: { sha256: cached.sha256, size_bytes: cached.size_bytes } })
          continue
        }

        const digest = await hashDriveFile(nextPath)
        if (!digest) {
          continue
        }
        options.onCacheUpdate?.(nextDrivePath, { mtime_ms: stats.mtimeMs, size_bytes: digest.sizeBytes, sha256: digest.sha256 })
        candidates.push({ path: nextDrivePath, entry: { sha256: digest.sha256, size_bytes: digest.sizeBytes } })
      } catch (error) {
        // Files can vanish or lock mid-scan (rename transitions, editors
        // holding locks); skip and let the next sync pass reconcile them.
        if (!isTransientScanError(error) || !options.onPathError) throw error
        await options.onPathError(nextDrivePath, error)
      }
    }
  }

  async function addNonCollidingFiles(candidates: Array<{ path: string; entry: DriveFileEntry }>): Promise<void> {
    const byCaseFoldedPath = new Map<string, Array<{ path: string; entry: DriveFileEntry }>>()
    for (const candidate of candidates) {
      const folded = candidate.path.toLowerCase()
      const group = byCaseFoldedPath.get(folded) ?? []
      group.push(candidate)
      byCaseFoldedPath.set(folded, group)
    }

    for (const group of byCaseFoldedPath.values()) {
      if (group.length > 1) {
        const sorted = group.sort((left, right) => left.path.localeCompare(right.path))
        for (const candidate of sorted) {
          const error = new Error(`LOCAL_PATH_CASE_CONFLICT: ${candidate.path}`)
          if (!options.onPathError) throw error
          await options.onPathError(candidate.path, error)
        }
        continue
      }
      const [candidate] = group
      if (candidate) files[candidate.path] = candidate.entry
    }
  }

  function isExcludedRootEntry(currentDrivePath: string, entry: Dirent): boolean {
    return currentDrivePath === "" && entry.name === DRIVE_DIR
  }
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

function isInternalSyncArtifactName(name: string): boolean {
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

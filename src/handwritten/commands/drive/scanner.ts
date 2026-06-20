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

export interface ScanDriveFilesOptions {
  onPathError?: (path: string, error: unknown) => void | Promise<void>
}

export async function scanDriveFiles(root: string, options: ScanDriveFilesOptions = {}): Promise<Record<string, DriveFileEntry>> {
  const candidates: Array<{ path: string; entry: DriveFileEntry }> = []
  const files: Record<string, DriveFileEntry> = {}
  const absRoot = root
  await walk(absRoot, "")
  await addNonCollidingFiles(candidates)
  return files

  async function walk(currentPath: string, currentDrivePath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
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

      const digest = await hashDriveFile(nextPath)
      if (!digest) {
        continue
      }
      candidates.push({ path: nextDrivePath, entry: { sha256: digest.sha256, size_bytes: digest.sizeBytes } })
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

function isInternalSyncArtifactName(name: string): boolean {
  if (!name.startsWith(".") || !name.endsWith(".tmp")) return false
  return name.includes(".wspc-download-") || name.includes(".wspc-backup-")
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

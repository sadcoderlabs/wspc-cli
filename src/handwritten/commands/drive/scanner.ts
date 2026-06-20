import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { Dirent, open, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { DRIVE_DIR } from "./state.js"
import { validateDrivePath } from "./path-policy.js"

export interface DriveFileEntry {
  size_bytes: number
  sha256: string
}

export async function scanDriveFiles(root: string): Promise<Record<string, DriveFileEntry>> {
  const files: Record<string, DriveFileEntry> = {}
  const absRoot = root
  await walk(absRoot, "")
  return files

  async function walk(currentPath: string, currentDrivePath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (isExcludedRootEntry(currentDrivePath, entry)) {
        continue
      }

      const nextDrivePath = currentDrivePath ? `${currentDrivePath}/${entry.name}` : entry.name
      validateDrivePath(nextDrivePath)
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

      const digest = await hashFile(nextPath)
      if (!digest) {
        continue
      }
      files[nextDrivePath] = {
        sha256: digest.sha256,
        size_bytes: digest.sizeBytes,
      }
    }
  }

  function isExcludedRootEntry(currentDrivePath: string, entry: Dirent): boolean {
    return currentDrivePath === "" && entry.name === DRIVE_DIR
  }
}

type FileDigest = { sizeBytes: number; sha256: string }

async function hashFile(path: string): Promise<FileDigest | undefined> {
  const fdFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const fileHandle = await open(path, fdFlags)
  const hash = createHash("sha256")
  let sizeBytes = 0
  try {
    const stats = await fileHandle.stat()
    if (!stats.isFile()) {
      return undefined
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

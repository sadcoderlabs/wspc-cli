import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { Dirent, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { DRIVE_DIR } from "./state.js"
import { validateDrivePath } from "./path-policy.js"

export interface DriveFileEntry {
  size_bytes: number
  sha256: string
}

export async function scanDriveFiles(root: string): Promise<Map<string, DriveFileEntry>> {
  const files = new Map<string, DriveFileEntry>()
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
      files.set(nextDrivePath, {
        sha256: digest.sha256,
        size_bytes: digest.sizeBytes,
      })
    }
  }

  function isExcludedRootEntry(currentDrivePath: string, entry: Dirent): boolean {
    return currentDrivePath === "" && entry.name === DRIVE_DIR
  }
}

async function hashFile(path: string): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256")
  let sizeBytes = 0
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
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
}

import { createWriteStream } from "node:fs"
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { resolveInsideRoot } from "./path-policy.js"
import { hashDriveFile } from "./scanner.js"
import type { DriveStateEntry } from "./state.js"

export type MergedLocalInstall = {
  finalize: () => Promise<void>
  restore: () => Promise<void>
}

export async function assertLocalStillScanned(
  localPath: string,
  scanned: { sha256: string; size_bytes: number },
): Promise<void> {
  const snapshot = await hashDriveFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!snapshot || snapshot.sha256 !== scanned.sha256 || snapshot.sizeBytes !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
}

export async function writeMergedLocalFile(
  root: string,
  path: string,
  bytes: Uint8Array,
  digest: string,
  scanned: { sha256: string; size_bytes: number },
  onLocalMutation: () => void,
): Promise<MergedLocalInstall> {
  const target = resolveInsideRoot(root, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.wspc-merge-${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, bytes, { flag: "wx" })
    return await installMergedLocalFile(root, path, tmp, scanned, digest, bytes.byteLength, onLocalMutation)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function installMergedLocalFile(
  root: string,
  path: string,
  tmp: string,
  scanned: { sha256: string; size_bytes: number },
  mergedSha256: string,
  mergedSizeBytes: number,
  onLocalMutation: () => void,
): Promise<MergedLocalInstall> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  let backupIsScannedLocal = false

  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error("local file changed after scan")
      }
      throw error
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest || backupDigest.sha256 !== scanned.sha256 || backupDigest.sizeBytes !== scanned.size_bytes) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed after scan")
    }
    backupIsScannedLocal = true

    try {
      await installNoOverwrite(tmp, target)
    } catch (error) {
      await restoreBackupWhenPossible(backup, target)
      throw error
    }
    return {
      finalize: async () => {
        await rm(backup, { force: true }).catch(() => {})
      },
      restore: async () => {
        await restoreMergedLocalFile(target, backup, scanned.sha256, scanned.size_bytes, mergedSha256, mergedSizeBytes)
      },
    }
  } catch (error) {
    if (!backupIsScannedLocal) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

async function restoreMergedLocalFile(
  target: string,
  backup: string,
  backupSha256: string,
  backupSizeBytes: number,
  mergedSha256: string,
  mergedSizeBytes: number,
): Promise<void> {
  const quarantine = join(dirname(target), `.${basename(target)}.wspc-merge-restore-${randomUUID()}.tmp`)
  try {
    await rename(target, quarantine)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
  const quarantineDigest = await hashDriveFile(quarantine).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (
    quarantineDigest !== undefined &&
    (quarantineDigest.sha256 !== mergedSha256 || quarantineDigest.sizeBytes !== mergedSizeBytes)
  ) {
    await restoreBackupWhenPossible(quarantine, target)
    return
  }
  const restored = await restoreBackupWhenPossible(backup, target)
  if (!restored) {
    await rm(quarantine, { force: true }).catch(() => {})
    return
  }
  await unlink(quarantine).catch(() => {})
  const restoredDigest = await hashDriveFile(target)
  if (!restoredDigest || restoredDigest.sha256 !== backupSha256 || restoredDigest.sizeBytes !== backupSizeBytes) {
    throw new Error("local file restore failed")
  }
}

export async function downloadRemote(
  root: string,
  libraryId: string,
  path: string,
  api: { downloadFile(id: string, path: string, versionId?: string): Promise<Response> },
  expectedSha256: string | undefined,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<string> {
  const target = resolveInsideRoot(root, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.wspc-download-${randomUUID()}.tmp`)
  try {
    const response = await api.downloadFile(libraryId, path)
    if (!response.body) {
      throw new Error("download response body missing")
    }
    const hash = createHash("sha256")
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback(undefined, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      hashingStream,
      createWriteStream(tmp, { flags: "wx" }),
    )
    const digest = hash.digest("hex")
    if (expectedSha256 !== undefined && digest !== expectedSha256) {
      throw new Error(`download hash mismatch: expected ${expectedSha256}, got ${digest}`)
    }
    await installDownloadedFile(root, path, tmp, entry, onLocalMutation)
    return digest
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function installDownloadedFile(
  root: string,
  path: string,
  tmp: string,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  const expectedSha256 = expectedLocalBaseSha256(entry)
  let backupIsExpectedBase = false

  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      await installNoOverwrite(tmp, target, onLocalMutation)
      return
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before download")
    }
    if (!expectedSha256 || backupDigest.sha256 !== expectedSha256) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before download")
    }
    backupIsExpectedBase = true

    try {
      await installNoOverwrite(tmp, target, onLocalMutation)
    } catch (error) {
      const restored = await restoreBackupWhenPossible(backup, target)
      if (!restored && backupIsExpectedBase) {
        await unlink(backup).catch(() => {})
      }
      throw error
    }
    await unlink(backup)
  } catch (error) {
    if (!backupIsExpectedBase) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

export async function removeLocalIfStillBase(
  root: string,
  path: string,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const backup = localMutationBackupPath(target)
  const expectedSha256 = expectedLocalBaseSha256(entry)
  if (!expectedSha256) {
    throw new Error("local file has no sync base")
  }

  let backupIsExpectedBase = false
  try {
    try {
      await rename(target, backup)
      onLocalMutation()
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error("local file changed before delete")
      }
      throw error
    }

    const backupDigest = await hashDriveFile(backup)
    if (!backupDigest || backupDigest.sha256 !== expectedSha256) {
      await restoreBackupWhenPossible(backup, target)
      throw new Error("local file changed before delete")
    }
    backupIsExpectedBase = true

    if (await localFileExists(target)) {
      await unlink(backup).catch(() => {})
      throw new Error("local file reappeared during delete")
    }
    await unlink(backup)
    if (await localFileExists(target)) {
      throw new Error("local file reappeared during delete")
    }
  } catch (error) {
    if (!backupIsExpectedBase) {
      await restoreBackupWhenPossible(backup, target)
    }
    throw error
  }
}

export async function installNoOverwrite(source: string, target: string, onLinked?: () => void): Promise<void> {
  await link(source, target)
  onLinked?.()
  await unlink(source)
}

async function restoreBackupWhenPossible(backup: string, target: string): Promise<boolean> {
  try {
    await installNoOverwrite(backup, target)
    return true
  } catch (error) {
    if (isAlreadyExistsError(error)) return false
    if (isNotFoundError(error)) return true
    return false
  }
}

export async function localFileExists(path: string): Promise<boolean> {
  const digest = await hashDriveFile(path).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  return digest !== undefined
}

function localMutationBackupPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.wspc-backup-${randomUUID()}.tmp`)
}

function expectedLocalBaseSha256(entry: DriveStateEntry | undefined): string | undefined {
  return entry?.last_local_sha256 ?? entry?.content_sha256
}

export async function readStableUploadBody(
  localPath: string,
  scanned: { sha256: string; size_bytes: number } | undefined,
): Promise<{ body: ArrayBuffer; digest: string }> {
  if (!scanned) {
    throw new Error("local file missing from scan")
  }
  const snapshot = await hashDriveFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!snapshot || snapshot.sha256 !== scanned.sha256 || snapshot.sizeBytes !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
  const body = await readFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!body) {
    throw new Error("local file changed after scan")
  }
  const uploadBytes = new Uint8Array(body.byteLength)
  uploadBytes.set(body)
  const digest = createHash("sha256").update(uploadBytes).digest("hex")
  if (digest !== scanned.sha256 || uploadBytes.byteLength !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
  return { body: uploadBytes.buffer, digest }
}

export async function assertLocalSafeForDownload(
  root: string,
  path: string,
  entry: DriveStateEntry | undefined,
): Promise<void> {
  const target = resolveInsideRoot(root, path)
  const digest = await hashDriveFile(target).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!digest) return

  if (!entry?.last_local_sha256) {
    throw new Error("local file appeared before download")
  }
  if (digest.sha256 !== entry.last_local_sha256) {
    throw new Error("local file changed before download")
  }
}

export async function assertLocalAbsentBeforeRemoteDelete(root: string, path: string): Promise<void> {
  const digest = await hashDriveFile(resolveInsideRoot(root, path)).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (digest) {
    throw new Error("local file appeared before remote delete")
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"
}

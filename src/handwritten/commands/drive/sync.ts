import { Command } from "commander"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { createDriveApi } from "./api.js"
import { decideDriveAction, type DriveAction } from "./decision.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"
import { hashDriveFile, scanDriveFiles } from "./scanner.js"
import {
  readDriveState,
  writeDriveState,
  withDriveLock,
  type DriveConflict,
  type DriveState,
  type DriveStateEntry,
} from "./state.js"
import { render } from "../../output/render.js"
import type { DriveManifestResponse, UploadDriveFileResponse } from "../../../generated/sdk/index.js"

type RemoteEntry = DriveManifestResponse["entries"][number]

export interface DriveSyncApi {
  getManifest(id: string, cursor?: string): Promise<DriveManifestResponse>
  uploadFile(
    id: string,
    path: string,
    body: BodyInit,
    sha256: string,
    expectedEntryVersion?: number,
  ): Promise<UploadDriveFileResponse>
  downloadFile(id: string, path: string): Promise<Response>
  deleteFile(id: string, path: string, expectedEntryVersion: number): Promise<unknown>
}

export type DriveSyncPathAction = DriveAction["type"] | "error"

export interface DriveSyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  unchanged: number
  conflicts: number
  errors: number
  paths: Array<{ path: string; action: DriveSyncPathAction }>
}

function emptySummary(): DriveSyncSummary {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    unchanged: 0,
    conflicts: 0,
    errors: 0,
    paths: [],
  }
}

export async function runDriveSyncOnce(root: string, api?: DriveSyncApi): Promise<DriveSyncSummary> {
  return withDriveLock(root, async () => {
    const state = await readDriveState(root)
    const syncApi = api ?? (await createDriveApi())
    const summary = emptySummary()
    const blockedPaths = new Set<string>()
    const localFiles = await scanDriveFiles(root, {
      onPathError: async (path, error) => {
        await recordPathError(summary, blockedPaths, path, error)
      },
    })
    const remoteFiles = await fetchRemoteManifest(root, state, syncApi, summary, blockedPaths)
    const paths = Array.from(
      new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles), ...Object.keys(state.entries)]),
    )
      .filter((path) => !blockedPaths.has(path))
      .sort((left, right) => left.localeCompare(right))

    for (const path of paths) {
      const remote = remoteFiles[path]
      const action = decideDriveAction(state.entries[path], localFiles[path], remote)
      await processPath({ root, state, api: syncApi, path, action, remote, local: localFiles[path], summary })
    }

    return summary
  })
}

export function driveSyncCommand(api?: DriveSyncApi): Command {
  const sync = new Command("sync").description("Drive sync commands")
  sync
    .command("once")
    .description("Run one Drive sync pass")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string) => {
      const summary = await runDriveSyncOnce(resolve(path), api)
      render({ kind: "drive_sync_once", display: { shape: "object" } }, summary)
      if (summary.conflicts > 0 || summary.errors > 0) {
        process.exitCode = 1
      }
    })
  return sync
}

async function fetchRemoteManifest(
  root: string,
  state: DriveState,
  api: DriveSyncApi,
  summary: DriveSyncSummary,
  blockedPaths: Set<string>,
): Promise<Record<string, RemoteEntry>> {
  const candidates: RemoteEntry[] = []
  const remoteFiles: Record<string, RemoteEntry> = {}
  let cursor: string | undefined
  do {
    const page = await api.getManifest(state.library_id, cursor)
    for (const entry of page.entries) {
      try {
        validateRemoteEntry(root, entry)
        candidates.push(entry)
      } catch (error) {
        await recordPathError(summary, blockedPaths, entry.path, error)
      }
    }
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)

  const byCaseFoldedPath = new Map<string, RemoteEntry[]>()
  for (const entry of candidates) {
    const folded = entry.path.toLowerCase()
    const group = byCaseFoldedPath.get(folded) ?? []
    group.push(entry)
    byCaseFoldedPath.set(folded, group)
  }

  for (const group of byCaseFoldedPath.values()) {
    const exactPathCounts = new Map<string, number>()
    for (const entry of group) {
      exactPathCounts.set(entry.path, (exactPathCounts.get(entry.path) ?? 0) + 1)
    }

    if (group.length > 1) {
      const hasExactDuplicate = Array.from(exactPathCounts.values()).some((count) => count > 1)
      const reason = hasExactDuplicate ? "REMOTE_PATH_DUPLICATE" : "REMOTE_PATH_CASE_CONFLICT"
      for (const entry of group.sort((left, right) => left.path.localeCompare(right.path))) {
        await recordPathError(summary, blockedPaths, entry.path, new Error(`${reason}: ${entry.path}`), {
          appendPathResult: true,
        })
      }
      continue
    }

    const [entry] = group
    if (entry) remoteFiles[entry.path] = entry
  }
  return remoteFiles
}

function validateRemoteEntry(root: string, entry: RemoteEntry): void {
  validateDrivePath(entry.path)
  resolveInsideRoot(root, entry.path)
}

async function processPath(args: {
  root: string
  state: DriveState
  api: DriveSyncApi
  path: string
  action: DriveAction
  remote: RemoteEntry | undefined
  local: { sha256: string; size_bytes: number } | undefined
  summary: DriveSyncSummary
}): Promise<void> {
  const { root, state, api, path, action, remote, local, summary } = args
  summary.paths.push({ path, action: action.type })

  try {
    if (action.type === "upload_create" || action.type === "upload_update") {
      const localPath = resolveInsideRoot(root, path)
      const uploadDigest = await assertLocalStillMatchesScan(localPath, local)
      const body = await readFile(localPath)
      const uploaded = await api.uploadFile(state.library_id, path, body, uploadDigest, action.expectedEntryVersion)
      state.entries[path] = stateEntryFromRemote(uploaded.entry, uploadDigest)
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.uploaded += 1
      return
    }

    if (action.type === "download") {
      if (!remote) throw new Error("remote entry missing for download")
      await assertLocalSafeForDownload(root, path, state.entries[path])
      const digest = await downloadRemote(root, state.library_id, path, api, remote.content_sha256)
      state.entries[path] = stateEntryFromRemote(remote, digest)
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.downloaded += 1
      return
    }

    if (action.type === "delete_remote") {
      await assertLocalAbsentBeforeRemoteDelete(root, path)
      await api.deleteFile(state.library_id, path, action.expectedEntryVersion)
      await rm(resolveInsideRoot(root, path), { force: true })
      delete state.entries[path]
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.deleted += 1
      return
    }

    if (action.type === "delete_local") {
      await assertLocalStillMatchesBase(root, path, state.entries[path])
      await rm(resolveInsideRoot(root, path), { force: true })
      delete state.entries[path]
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.deleted += 1
      return
    }

    if (action.type === "state_only") {
      if (!remote) throw new Error("remote entry missing for state update")
      state.entries[path] = stateEntryFromRemote(remote, local?.sha256 ?? remote.content_sha256)
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.unchanged += 1
      return
    }

    if (action.type === "remove_state") {
      delete state.entries[path]
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.unchanged += 1
      return
    }

    if (action.type === "conflict") {
      await recordConflict(root, state, path, action.reason, remote)
      summary.conflicts += 1
      return
    }

    summary.unchanged += 1
  } catch (error) {
    if (isVersionConflict(error)) {
      await recordConflict(root, state, path, "VERSION_CONFLICT", remote)
      summary.conflicts += 1
      summary.paths[summary.paths.length - 1] = { path, action: "conflict" }
      return
    }
    await recordPathError(summary, undefined, path, error)
  }
}

async function downloadRemote(
  root: string,
  libraryId: string,
  path: string,
  api: DriveSyncApi,
  expectedSha256: string | undefined,
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
    await rename(tmp, target)
    return digest
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function assertLocalStillMatchesScan(
  localPath: string,
  scanned: { sha256: string; size_bytes: number } | undefined,
): Promise<string> {
  if (!scanned) {
    throw new Error("local file missing from scan")
  }
  const digest = await hashDriveFile(localPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!digest) {
    throw new Error("local file changed after scan")
  }
  if (digest.sha256 !== scanned.sha256 || digest.sizeBytes !== scanned.size_bytes) {
    throw new Error("local file changed after scan")
  }
  return digest.sha256
}

async function assertLocalSafeForDownload(
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

async function assertLocalStillMatchesBase(root: string, path: string, entry: DriveStateEntry | undefined): Promise<void> {
  const expectedSha256 = entry?.last_local_sha256 ?? entry?.content_sha256
  if (!expectedSha256) {
    throw new Error("local file has no sync base")
  }
  const digest = await hashDriveFile(resolveInsideRoot(root, path)).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (!digest || digest.sha256 !== expectedSha256) {
    throw new Error("local file changed before delete")
  }
}

async function assertLocalAbsentBeforeRemoteDelete(root: string, path: string): Promise<void> {
  const digest = await hashDriveFile(resolveInsideRoot(root, path)).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined
    throw error
  })
  if (digest) {
    throw new Error("local file appeared before remote delete")
  }
}

function stateEntryFromRemote(remote: RemoteEntry, localSha256: string | undefined): DriveStateEntry {
  return {
    entry_id: remote.id,
    entry_version: remote.entry_version,
    current_version_id: remote.current_version_id,
    content_sha256: remote.content_sha256,
    size_bytes: remote.size_bytes,
    last_local_sha256: localSha256,
    last_synced_at: new Date().toISOString(),
    status: "synced",
  }
}

async function recordConflict(
  root: string,
  state: DriveState,
  path: string,
  reason: string,
  remote: RemoteEntry | undefined,
): Promise<void> {
  state.conflicts[path] = conflict(reason, remote)
  await writeDriveState(root, state)
}

async function recordPathError(
  summary: DriveSyncSummary,
  blockedPaths: Set<string> | undefined,
  path: string,
  error: unknown,
  options: { appendPathResult?: boolean } = {},
): Promise<void> {
  blockedPaths?.add(path)
  const lastPath = summary.paths.at(-1)
  if (!options.appendPathResult && lastPath?.path === path) {
    lastPath.action = "error"
  } else {
    summary.paths.push({ path, action: "error" })
  }
  void errorMessage(error)
  summary.errors += 1
}

function conflict(reason: string, remote: RemoteEntry | undefined): DriveConflict {
  return {
    detected_at: new Date().toISOString(),
    reason,
    remote_entry_version: remote?.entry_version,
    remote_version_id: remote?.current_version_id,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isVersionConflict(error: unknown): boolean {
  const structured = error as { code?: unknown; status?: unknown; response?: { status?: unknown } } | undefined
  if (structured?.code === "VERSION_CONFLICT") return true
  if (structured?.status === 409 || structured?.response?.status === 409) return true

  return /VERSION_CONFLICT|HTTP 409\b/.test(errorMessage(error))
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

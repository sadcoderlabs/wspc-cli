import { Command } from "commander"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { createDriveApi } from "./api.js"
import { decideDriveAction, type DriveAction } from "./decision.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"
import { scanDriveFiles } from "./scanner.js"
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
    const localFiles = await scanDriveFiles(root, {
      onPathError: async (path, error) => {
        await recordPathError(root, state, summary, path, error, undefined)
      },
    })
    const remoteFiles = await fetchRemoteManifest(root, state, syncApi, summary)
    const paths = Array.from(
      new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles), ...Object.keys(state.entries)]),
    ).sort((left, right) => left.localeCompare(right))

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
): Promise<Record<string, RemoteEntry>> {
  const remoteFiles: Record<string, RemoteEntry> = {}
  let cursor: string | undefined
  do {
    const page = await api.getManifest(state.library_id, cursor)
    for (const entry of page.entries) {
      try {
        validateRemoteEntry(root, entry)
        remoteFiles[entry.path] = entry
      } catch (error) {
        await recordPathError(root, state, summary, entry.path, error, entry)
      }
    }
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
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
      const body = await readFile(localPath)
      const uploaded = await api.uploadFile(state.library_id, path, body, local?.sha256 ?? "", action.expectedEntryVersion)
      state.entries[path] = stateEntryFromRemote(uploaded.entry, local?.sha256 ?? uploaded.entry.content_sha256)
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.uploaded += 1
      return
    }

    if (action.type === "download") {
      if (!remote) throw new Error("remote entry missing for download")
      const digest = await downloadRemote(root, state.library_id, path, api)
      state.entries[path] = stateEntryFromRemote(remote, digest)
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.downloaded += 1
      return
    }

    if (action.type === "delete_remote") {
      await api.deleteFile(state.library_id, path, action.expectedEntryVersion)
      await rm(resolveInsideRoot(root, path), { force: true })
      delete state.entries[path]
      delete state.conflicts[path]
      await writeDriveState(root, state)
      summary.deleted += 1
      return
    }

    if (action.type === "delete_local") {
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
    await recordPathError(root, state, summary, path, error, remote)
  }
}

async function downloadRemote(root: string, libraryId: string, path: string, api: DriveSyncApi): Promise<string> {
  const target = resolveInsideRoot(root, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.wspc-download-${randomUUID()}.tmp`)
  try {
    const response = await api.downloadFile(libraryId, path)
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(tmp, bytes, { flag: "wx" })
    await rename(tmp, target)
    return sha256(bytes)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
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
  root: string,
  state: DriveState,
  summary: DriveSyncSummary,
  path: string,
  error: unknown,
  remote: RemoteEntry | undefined,
): Promise<void> {
  const lastPath = summary.paths.at(-1)
  if (lastPath?.path === path) {
    lastPath.action = "error"
  } else {
    summary.paths.push({ path, action: "error" })
  }
  state.conflicts[path] = conflict(errorMessage(error), remote)
  await writeDriveState(root, state)
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
  return /VERSION_CONFLICT|HTTP 409|\b409\b/.test(errorMessage(error))
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

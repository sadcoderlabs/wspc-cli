import type {
  DriveManifestResponse,
  MoveDriveFileResponse,
  UploadDriveFileResponse,
} from "../../../generated/sdk/index.js"
import type { DriveAction } from "./decision.js"
import type { DrivePathErrorSummary } from "./retry.js"

export type RemoteEntry = DriveManifestResponse["entries"][number]

export interface DriveSyncApi {
  getManifest(id: string, cursor?: string, sinceCursor?: string): Promise<DriveManifestResponse>
  uploadFile(
    id: string,
    path: string,
    body: BodyInit,
    sha256: string,
    expectedEntryVersion?: number,
  ): Promise<UploadDriveFileResponse>
  downloadFile(id: string, path: string, versionId?: string): Promise<Response>
  deleteFile(id: string, path: string, expectedEntryVersion: number): Promise<unknown>
  moveFile?(
    id: string,
    fromPath: string,
    toPath: string,
    expectedEntryVersion?: number,
  ): Promise<MoveDriveFileResponse>
}

export type DrivePathActionApi = Pick<
  DriveSyncApi,
  "uploadFile" | "downloadFile" | "deleteFile"
>

export type DriveSyncPathAction = DriveAction["type"] | "error" | "merged" | "move"

export interface DriveSyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  unchanged: number
  merged: number
  conflicts: number
  errors: number
  conflict_paths: string[]
  path_errors?: DrivePathErrorSummary[]
  paths: Array<{ path: string; action: DriveSyncPathAction; conflict_paths?: string[] }>
}

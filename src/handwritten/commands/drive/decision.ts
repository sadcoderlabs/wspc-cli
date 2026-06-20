export type DriveAction =
  | { type: "upload_create"; expectedEntryVersion: 0 }
  | { type: "upload_update"; expectedEntryVersion: number }
  | { type: "download" }
  | { type: "delete_remote"; expectedEntryVersion: number }
  | { type: "state_only" }
  | { type: "remove_state" }
  | { type: "conflict"; reason: string }
  | { type: "unchanged" }

export interface DecisionEntry {
  entry_version: number
  content_sha256?: string
  last_local_sha256?: string
}

export interface DecisionLocal {
  sha256: string
}

export interface DecisionRemote {
  content_sha256?: string
  entry_version?: number
}

export function decideDriveAction(
  entry: DecisionEntry | undefined,
  local: DecisionLocal | undefined,
  remote: DecisionRemote | undefined,
): DriveAction {
  if (!entry) {
    if (local && !remote) return { type: "upload_create", expectedEntryVersion: 0 }
    if (!local && remote) return { type: "download" }
    if (local && remote) {
      return local.sha256 === remote.content_sha256
        ? { type: "state_only" }
        : { type: "conflict", reason: "local_and_remote_without_base" }
    }
    return { type: "unchanged" }
  }

  if (!local && !remote) return { type: "remove_state" }

  const localUnchanged = !local || local.sha256 === entry.last_local_sha256
  const remoteUnchanged = !remote || remote.content_sha256 === entry.content_sha256

  if (!local && remoteUnchanged) return { type: "delete_remote", expectedEntryVersion: entry.entry_version }
  if (!local && !remoteUnchanged) return { type: "conflict", reason: "remote_changed_before_delete" }
  if (local && !remote) {
    return localUnchanged
      ? { type: "delete_remote", expectedEntryVersion: entry.entry_version }
      : { type: "upload_update", expectedEntryVersion: entry.entry_version }
  }
  if (local && remote && localUnchanged && !remoteUnchanged) return { type: "download" }
  if (local && remote && !localUnchanged && remoteUnchanged) {
    return { type: "upload_update", expectedEntryVersion: entry.entry_version }
  }
  if (local && remote && !localUnchanged && !remoteUnchanged) {
    return { type: "conflict", reason: "local_and_remote_changed" }
  }

  return { type: "unchanged" }
}

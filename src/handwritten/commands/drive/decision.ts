export type DriveAction =
  | { type: "upload_create"; expectedEntryVersion: 0 }
  | { type: "upload_update"; expectedEntryVersion: number }
  | { type: "download" }
  | { type: "delete_remote"; expectedEntryVersion: number }
  | { type: "delete_local" }
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

type LocalStatus = "unchanged" | "changed" | "unknown"
type RemoteStatus = "unchanged" | "content_same_new_version" | "changed" | "missing_version"

export function decideDriveAction(
  entry: DecisionEntry | undefined,
  local: DecisionLocal | undefined,
  remote: DecisionRemote | undefined,
): DriveAction {
  if (!entry) return decideWithoutBase(local, remote)

  if (!local && !remote) return { type: "remove_state" }

  const localStatus = getLocalStatus(entry, local)
  const remoteStatus = getRemoteStatus(entry, remote)

  if (!remote) return decideRemoteMissing(localStatus)
  if (!local) return decideLocalMissing(entry, remoteStatus)
  return decideBothPresent(entry, localStatus, remoteStatus, local, remote)
}

function decideWithoutBase(local: DecisionLocal | undefined, remote: DecisionRemote | undefined): DriveAction {
  if (local && !remote) return { type: "upload_create", expectedEntryVersion: 0 }
  if (!local && remote) {
    return remote.entry_version === undefined
      ? { type: "conflict", reason: "remote_missing_entry_version" }
      : { type: "download" }
  }
  if (local && remote) {
    if (remote.entry_version === undefined) return { type: "conflict", reason: "remote_missing_entry_version" }
    return remote.content_sha256 !== undefined && local.sha256 === remote.content_sha256
      ? { type: "state_only" }
      : { type: "conflict", reason: "local_and_remote_without_base" }
  }
  return { type: "unchanged" }
}

function decideRemoteMissing(localStatus: LocalStatus): DriveAction {
  if (localStatus === "unchanged") return { type: "delete_local" }
  if (localStatus === "unknown") return { type: "conflict", reason: "unknown_local_base_remote_deleted" }
  return { type: "conflict", reason: "local_changed_remote_deleted" }
}

function decideLocalMissing(entry: DecisionEntry, remoteStatus: RemoteStatus): DriveAction {
  if (remoteStatus === "unchanged") return { type: "delete_remote", expectedEntryVersion: entry.entry_version }
  return { type: "conflict", reason: "remote_changed_before_delete" }
}

function decideBothPresent(
  entry: DecisionEntry,
  localStatus: LocalStatus,
  remoteStatus: RemoteStatus,
  local: DecisionLocal,
  remote: DecisionRemote,
): DriveAction {
  // Identical bytes on both sides means the conflict is already converged,
  // whatever the base says; only the state entry needs to catch up.
  const converged = remote.content_sha256 !== undefined && local.sha256 === remote.content_sha256

  if (localStatus === "unchanged" && remoteStatus === "content_same_new_version") {
    return { type: "state_only" }
  }
  if (remoteStatus === "missing_version") {
    return { type: "conflict", reason: "remote_missing_entry_version" }
  }
  if (localStatus === "unknown" && remoteStatus !== "unchanged") {
    return converged ? { type: "state_only" } : { type: "conflict", reason: "unknown_local_base_remote_changed" }
  }
  if (localStatus === "unknown") return { type: "conflict", reason: "unknown_local_base" }
  if (localStatus === "unchanged" && remoteStatus === "changed") return { type: "download" }
  if (localStatus === "changed" && remoteStatus === "unchanged") {
    return { type: "upload_update", expectedEntryVersion: entry.entry_version }
  }
  if (localStatus !== "unchanged" && remoteStatus !== "unchanged") {
    return converged ? { type: "state_only" } : { type: "conflict", reason: "local_and_remote_changed" }
  }

  return { type: "unchanged" }
}

function getLocalStatus(entry: DecisionEntry, local: DecisionLocal | undefined): LocalStatus {
  if (!local) return "changed"
  if (entry.last_local_sha256 !== undefined) {
    return local.sha256 === entry.last_local_sha256 ? "unchanged" : "changed"
  }
  if (entry.content_sha256 !== undefined) {
    return local.sha256 === entry.content_sha256 ? "unchanged" : "changed"
  }
  return "unknown"
}

function getRemoteStatus(
  entry: DecisionEntry,
  remote: DecisionRemote | undefined,
): RemoteStatus {
  if (!remote) return "changed"
  if (remote.entry_version !== undefined && remote.entry_version === entry.entry_version) return "unchanged"
  if (remote.entry_version === undefined) return "missing_version"
  if (
    remote.content_sha256 !== undefined &&
    entry.content_sha256 !== undefined &&
    remote.content_sha256 === entry.content_sha256
  ) {
    return "content_same_new_version"
  }
  return "changed"
}

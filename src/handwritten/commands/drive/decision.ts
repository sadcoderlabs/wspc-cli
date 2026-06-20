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

export function decideDriveAction(
  entry: DecisionEntry | undefined,
  local: DecisionLocal | undefined,
  remote: DecisionRemote | undefined,
): DriveAction {
  if (!entry) {
    if (local && !remote) return { type: "upload_create", expectedEntryVersion: 0 }
    if (!local && remote) return { type: "download" }
    if (local && remote) {
      return remote.content_sha256 !== undefined && local.sha256 === remote.content_sha256
        ? { type: "state_only" }
        : { type: "conflict", reason: "local_and_remote_without_base" }
    }
    return { type: "unchanged" }
  }

  if (!local && !remote) return { type: "remove_state" }

  const localStatus = getLocalStatus(entry, local)
  const remoteStatus = getRemoteStatus(entry, remote)

  if (local && !remote) {
    if (localStatus === "unchanged") return { type: "delete_local" }
    if (localStatus === "unknown") return { type: "conflict", reason: "unknown_local_base_remote_deleted" }
    return { type: "conflict", reason: "local_changed_remote_deleted" }
  }

  if (!local && remoteStatus === "unchanged") return { type: "delete_remote", expectedEntryVersion: entry.entry_version }
  if (!local && remoteStatus !== "unchanged") return { type: "conflict", reason: "remote_changed_before_delete" }
  if (local && remote && localStatus === "unchanged" && remoteStatus === "content_same_new_version") {
    return { type: "state_only" }
  }
  if (local && remote && remoteStatus === "missing_version") {
    return { type: "conflict", reason: "remote_missing_entry_version" }
  }
  if (local && remote && localStatus === "unknown" && remoteStatus !== "unchanged") {
    return { type: "conflict", reason: "unknown_local_base_remote_changed" }
  }
  if (local && remote && localStatus === "unknown") return { type: "conflict", reason: "unknown_local_base" }
  if (local && remote && localStatus === "unchanged" && remoteStatus === "changed") return { type: "download" }
  if (local && remote && localStatus === "changed" && remoteStatus === "unchanged") {
    return { type: "upload_update", expectedEntryVersion: entry.entry_version }
  }
  if (local && remote && localStatus !== "unchanged" && remoteStatus !== "unchanged") {
    return { type: "conflict", reason: "local_and_remote_changed" }
  }

  return { type: "unchanged" }
}

function getLocalStatus(entry: DecisionEntry, local: DecisionLocal | undefined): "unchanged" | "changed" | "unknown" {
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
): "unchanged" | "content_same_new_version" | "changed" | "missing_version" {
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

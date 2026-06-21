import type { DriveManifestResponse } from "../../../generated/sdk/index.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"

type RemoteManifestEntry = DriveManifestResponse["entries"][number]

export type RemoteManifestPathError = {
  path: string
  error: Error
  appendPathResult?: boolean
}

export type NormalizedRemoteManifest = {
  remoteFiles: Record<string, RemoteManifestEntry>
  pathErrors: RemoteManifestPathError[]
}

export function normalizeRemoteManifest(
  root: string,
  entries: RemoteManifestEntry[],
): NormalizedRemoteManifest {
  const candidates: RemoteManifestEntry[] = []
  const remoteFiles: Record<string, RemoteManifestEntry> = {}
  const pathErrors: RemoteManifestPathError[] = []

  for (const entry of entries) {
    try {
      validateDrivePath(entry.path)
      resolveInsideRoot(root, entry.path)
      candidates.push(entry)
    } catch (error) {
      pathErrors.push({ path: entry.path, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  const byCaseFoldedPath = new Map<string, RemoteManifestEntry[]>()
  for (const entry of candidates) {
    const folded = entry.path.toLowerCase()
    const group = byCaseFoldedPath.get(folded) ?? []
    group.push(entry)
    byCaseFoldedPath.set(folded, group)
  }

  for (const group of byCaseFoldedPath.values()) {
    if (group.length > 1) {
      const hasExactDuplicate = new Set(group.map((entry) => entry.path)).size < group.length
      const reason = hasExactDuplicate ? "REMOTE_PATH_DUPLICATE" : "REMOTE_PATH_CASE_CONFLICT"
      for (const entry of group.sort((left, right) => left.path.localeCompare(right.path))) {
        pathErrors.push({
          path: entry.path,
          error: new Error(`${reason}: ${entry.path}`),
          appendPathResult: true,
        })
      }
      continue
    }

    const [entry] = group
    if (entry) remoteFiles[entry.path] = entry
  }

  return { remoteFiles, pathErrors }
}

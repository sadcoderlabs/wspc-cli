import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeRemoteManifest } from "../../../src/handwritten/commands/drive/manifest.js"
import type { DriveManifestResponse } from "../../../src/generated/sdk/index.js"

type RemoteEntry = DriveManifestResponse["entries"][number]

function entry(path: string): RemoteEntry {
  return {
    id: `ent_${path.replace(/[^a-z0-9]/gi, "_")}`,
    path,
    kind: "file",
    entry_version: 1,
    current_version_id: "ver_1",
    content_sha256: "sha",
    size_bytes: 3,
    updated_at: "2026-06-21T00:00:00.000Z",
  }
}

describe("drive remote manifest normalization", () => {
  const root = resolve("/tmp/wspc-drive-root")

  it("keeps valid entries by exact path", () => {
    const a = entry("docs/a.txt")
    const b = entry("docs/b.txt")

    expect(normalizeRemoteManifest(root, [a, b])).toEqual({
      remoteFiles: { "docs/a.txt": a, "docs/b.txt": b },
      pathErrors: [],
    })
  })

  it("returns invalid paths as errors without accepting them", () => {
    const result = normalizeRemoteManifest(root, [
      entry("../escape.txt"),
      entry("/absolute.txt"),
      entry("bad\\\\slash.txt"),
    ])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual([
      "../escape.txt",
      "/absolute.txt",
      "bad\\\\slash.txt",
    ])
    expect(result.pathErrors.every((error) => error.error instanceof Error)).toBe(true)
  })

  it("reports case-only collisions for every ambiguous entry", () => {
    const result = normalizeRemoteManifest(root, [entry("A.txt"), entry("a.txt")])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual(["a.txt", "A.txt"])
    expect(result.pathErrors.map((error) => error.error.message)).toEqual([
      "REMOTE_PATH_CASE_CONFLICT: a.txt",
      "REMOTE_PATH_CASE_CONFLICT: A.txt",
    ])
    expect(result.pathErrors.every((error) => error.appendPathResult)).toBe(true)
  })

  it("reports exact duplicate paths for each duplicate entry", () => {
    const result = normalizeRemoteManifest(root, [entry("dup.txt"), entry("dup.txt")])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual(["dup.txt", "dup.txt"])
    expect(result.pathErrors.map((error) => error.error.message)).toEqual([
      "REMOTE_PATH_DUPLICATE: dup.txt",
      "REMOTE_PATH_DUPLICATE: dup.txt",
    ])
    expect(result.pathErrors.every((error) => error.appendPathResult)).toBe(true)
  })
})

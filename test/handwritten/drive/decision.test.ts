import { describe, expect, it } from "vitest"
import {
  decideDriveAction,
  type DecisionEntry,
  type DecisionLocal,
  type DecisionRemote,
  type DriveAction,
} from "../../../src/handwritten/commands/drive/decision.js"

const base: DecisionEntry = {
  entry_version: 1,
  content_sha256: "old",
  last_local_sha256: "old",
}

const versionOnlyBase: DecisionEntry = {
  entry_version: 1,
}

describe("drive decision", () => {
  const cases: ReadonlyArray<
    readonly [
      string,
      DecisionEntry | undefined,
      DecisionLocal | undefined,
      DecisionRemote | undefined,
      DriveAction["type"],
    ]
  > = [
    ["new local", undefined, { sha256: "a" }, undefined, "upload_create"],
    ["new remote", undefined, undefined, { content_sha256: "a" }, "download"],
    ["same first sight", undefined, { sha256: "a" }, { content_sha256: "a" }, "state_only"],
    ["different first sight", undefined, { sha256: "a" }, { content_sha256: "b" }, "conflict"],
    ["delete remote", base, undefined, { content_sha256: "old", entry_version: 1 }, "delete_remote"],
    ["download changed remote", base, { sha256: "old" }, { content_sha256: "new", entry_version: 2 }, "download"],
    ["upload changed local", base, { sha256: "new" }, { content_sha256: "old", entry_version: 1 }, "upload_update"],
    ["delete unchanged local when remote is gone", base, { sha256: "old" }, undefined, "delete_local"],
    ["conflict changed local when remote is gone", base, { sha256: "new" }, undefined, "conflict"],
    ["both changed", base, { sha256: "new" }, { content_sha256: "remote", entry_version: 2 }, "conflict"],
    ["remove gone", base, undefined, undefined, "remove_state"],
  ]

  it.each(cases)(
    "%s",
    (
      _name,
      entry: DecisionEntry | undefined,
      local: DecisionLocal | undefined,
      remote: DecisionRemote | undefined,
      action: ReturnType<typeof decideDriveAction>["type"],
    ) => {
      expect(decideDriveAction(entry, local, remote).type).toBe(action)
    },
  )

  it("uses the base state entry version for uploads and deletes", () => {
    expect(
      decideDriveAction(base, { sha256: "new" }, { content_sha256: "old", entry_version: 1 }),
    ).toEqual({ type: "upload_update", expectedEntryVersion: 1 })
    expect(decideDriveAction(base, undefined, { content_sha256: "old", entry_version: 1 })).toEqual({
      type: "delete_remote",
      expectedEntryVersion: 1,
    })
  })

  it("reports conservative conflict reasons", () => {
    expect(decideDriveAction(undefined, { sha256: "local" }, { content_sha256: "remote" })).toEqual({
      type: "conflict",
      reason: "local_and_remote_without_base",
    })
    expect(decideDriveAction(base, undefined, { content_sha256: "remote", entry_version: 2 })).toEqual({
      type: "conflict",
      reason: "remote_changed_before_delete",
    })
    expect(decideDriveAction(base, { sha256: "local" }, { content_sha256: "remote", entry_version: 2 })).toEqual({
      type: "conflict",
      reason: "local_and_remote_changed",
    })
    expect(decideDriveAction(base, { sha256: "local" }, undefined)).toEqual({
      type: "conflict",
      reason: "local_changed_remote_deleted",
    })
  })

  it("uses explicit content hash as local unchanged proof when last local hash is missing", () => {
    const entry: DecisionEntry = { entry_version: 1, content_sha256: "same" }

    expect(decideDriveAction(entry, { sha256: "same" }, undefined)).toEqual({ type: "delete_local" })
  })

  it("conflicts when local safety depends on missing base hashes", () => {
    expect(decideDriveAction(versionOnlyBase, { sha256: "local" }, undefined)).toEqual({
      type: "conflict",
      reason: "unknown_local_base_remote_deleted",
    })
    expect(decideDriveAction(versionOnlyBase, { sha256: "local" }, { entry_version: 2 })).toEqual({
      type: "conflict",
      reason: "unknown_local_base_remote_changed",
    })
    expect(decideDriveAction(versionOnlyBase, { sha256: "local" }, { entry_version: 1 })).toEqual({
      type: "conflict",
      reason: "unknown_local_base",
    })
  })

  it("does not compare missing content hashes as unchanged", () => {
    expect(decideDriveAction(versionOnlyBase, undefined, { entry_version: 2 })).toEqual({
      type: "conflict",
      reason: "remote_changed_before_delete",
    })
    expect(decideDriveAction(versionOnlyBase, undefined, { entry_version: 1 })).toEqual({
      type: "delete_remote",
      expectedEntryVersion: 1,
    })
  })

  it("updates state when remote content is same at a newer version and local is unchanged", () => {
    expect(decideDriveAction(base, { sha256: "old" }, { content_sha256: "old", entry_version: 2 })).toEqual({
      type: "state_only",
    })
  })

  it("conflicts when local changed and remote version changed even with the same content hash", () => {
    const entry: DecisionEntry = { entry_version: 1, content_sha256: "remote", last_local_sha256: "old" }

    expect(decideDriveAction(entry, { sha256: "local" }, { content_sha256: "remote", entry_version: 2 })).toEqual({
      type: "conflict",
      reason: "local_and_remote_changed",
    })
  })
})

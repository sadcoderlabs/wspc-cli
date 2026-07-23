import { DateTime } from "luxon"
import { describe, expect, it } from "vitest"
import { noopDriveDebugLogger } from "../../../src/handwritten/commands/drive/debug-log.js"
import {
  executeDrivePathAction,
} from "../../../src/handwritten/commands/drive/path-executor.js"
import type { DriveClock } from "../../../src/handwritten/commands/drive/clock.js"
import type { DriveState } from "../../../src/handwritten/commands/drive/state.js"
import type {
  DrivePathActionApi,
  DriveSyncSummary,
} from "../../../src/handwritten/commands/drive/sync-contracts.js"

const clock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00Z", { setZone: true }),
}

const state: DriveState = {
  schema_version: 1,
  library_id: "lib_1",
  created_at: "2026-06-21T10:10:00.000Z",
  updated_at: "2026-06-21T10:10:00.000Z",
  entries: {},
  conflicts: {},
}

const api: DrivePathActionApi = {
  async uploadFile() {
    throw new Error("unexpected upload")
  },
  async downloadFile() {
    throw new Error("unexpected download")
  },
  async deleteFile() {
    throw new Error("unexpected delete")
  },
}

function emptySummary(): DriveSyncSummary {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    unchanged: 0,
    merged: 0,
    conflicts: 0,
    errors: 0,
    conflict_paths: [],
    path_errors: [],
    paths: [],
  }
}

describe("executeDrivePathAction", () => {
  it("owns the per-path summary and return contract", async () => {
    const summary = emptySummary()

    const result = await executeDrivePathAction({
      root: "/unused",
      state,
      api,
      path: "same.txt",
      action: { type: "unchanged" },
      remote: undefined,
      local: undefined,
      summary,
      clock,
      debug: noopDriveDebugLogger,
    })

    expect(result).toEqual({ state, stop: false })
    expect(summary.unchanged).toBe(1)
    expect(summary.paths).toEqual([{ path: "same.txt", action: "unchanged" }])
  })
})

import { DateTime } from "luxon"
import { describe, expect, it } from "vitest"
import { driveConflictTimestamp, driveIsoTimestamp, type DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00.123+08:00", { setZone: true }),
}

const invalidClock: DriveClock = {
  now: () => DateTime.invalid("bad clock"),
}

describe("drive clock", () => {
  it("formats ISO timestamps with zone information", () => {
    expect(driveIsoTimestamp(fixedClock)).toBe("2026-06-21T10:10:00.123+08:00")
  })

  it("formats conflict filename timestamps in UTC seconds", () => {
    expect(driveConflictTimestamp(fixedClock)).toBe("20260621T021000Z")
  })

  it("rejects invalid clock timestamps", () => {
    expect(() => driveIsoTimestamp(invalidClock)).toThrow("invalid drive clock timestamp")
    expect(() => driveConflictTimestamp(invalidClock)).toThrow("invalid drive clock timestamp")
  })
})

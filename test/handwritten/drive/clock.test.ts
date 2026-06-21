import { DateTime } from "luxon"
import { describe, expect, it } from "vitest"
import { driveConflictTimestamp, driveIsoTimestamp, type DriveClock } from "../../../src/handwritten/commands/drive/clock.js"

const fixedClock: DriveClock = {
  now: () => DateTime.fromISO("2026-06-21T10:10:00.123+08:00", { setZone: true }),
}

describe("drive clock", () => {
  it("formats ISO timestamps with zone information", () => {
    expect(driveIsoTimestamp(fixedClock)).toBe("2026-06-21T10:10:00.123+08:00")
  })

  it("formats conflict filename timestamps in UTC seconds", () => {
    expect(driveConflictTimestamp(fixedClock)).toBe("20260621T021000Z")
  })
})

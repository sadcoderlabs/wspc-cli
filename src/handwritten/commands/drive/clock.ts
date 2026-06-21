import { DateTime } from "luxon"

export interface DriveClock {
  now(): DateTime
}

export const systemDriveClock: DriveClock = {
  now: () => DateTime.utc(),
}

export function driveIsoTimestamp(clock: DriveClock = systemDriveClock): string {
  const timestamp = clock.now().toISO()
  if (timestamp === null) {
    throw new Error("invalid drive clock timestamp")
  }
  return timestamp
}

export function driveConflictTimestamp(clock: DriveClock = systemDriveClock): string {
  const timestamp = clock.now().toUTC()
  if (!timestamp.isValid) {
    throw new Error("invalid drive clock timestamp")
  }
  return timestamp.toFormat("yyyyLLdd'T'HHmmss'Z'")
}

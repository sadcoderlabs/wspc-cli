import { DateTime } from "luxon"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export class ParseDateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParseDateError"
  }
}

export function parseDateOnly(input: string): string {
  if (!ISO_DATE.test(input)) {
    throw new ParseDateError(
      `Cannot parse date: "${input}". Use YYYY-MM-DD (e.g. 2026-05-10) when --all-day is set.`,
    )
  }
  const dt = DateTime.fromISO(input)
  if (!dt.isValid) {
    throw new ParseDateError(`Invalid date: "${input}".`)
  }
  return input
}

export function inclusiveEndToExclusive(date: string): string {
  return DateTime.fromISO(parseDateOnly(date)).plus({ days: 1 }).toISODate()!
}

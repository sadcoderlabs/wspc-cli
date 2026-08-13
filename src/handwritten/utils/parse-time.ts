import * as chrono from "chrono-node"
import { DateTime } from "luxon"

export class ParseTimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParseTimeError"
  }
}

export function resolveTimezone(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return flag ?? env.WSPC_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function parseOccurrenceBoundary(input: string, zone: string): string {
  if (DATE_ONLY.test(input)) {
    const date = DateTime.fromISO(input, { zone: "utc" })
    if (date.isValid && date.toISODate() === input) return input
    throw new ParseTimeError(`Cannot parse occurrence boundary: "${input}".`)
  }
  return parseTimeInput(input, zone).toISO()!
}

export function parseAgendaBoundary(input: string, zone: string): string {
  const value = parseTimeInput(input, zone)
  const iso = value.toISO()
  if (!value.isValid || !iso) {
    throw new ParseTimeError(`Cannot parse agenda boundary: "${input}".`)
  }
  return iso
}

export function parseTimeInput(input: string, zone: string): DateTime {
  // Only fast-path ISO strings that carry an explicit offset/Z. Naive ISO
  // (e.g. "2026-05-12T10:00") would land in the system zone with setZone:true,
  // not the caller's `zone`. Let those fall through to chrono + fromObject.
  if (HAS_OFFSET.test(input)) {
    const iso = DateTime.fromISO(input, { setZone: true })
    if (iso.isValid) return iso
  }

  const nowInZone = DateTime.now().setZone(zone)
  const refDate = new Date(
    nowInZone.year,
    nowInZone.month - 1,
    nowInZone.day,
    nowInZone.hour,
    nowInZone.minute,
    nowInZone.second,
    nowInZone.millisecond,
  )
  const start = chrono.parse(input, refDate, { forwardDate: true })[0]?.start
  if (!start) {
    throw new ParseTimeError(
      `Cannot parse time: "${input}". Use ISO 8601 (e.g. 2026-05-12T10:00+08:00) or natural language (e.g. "tomorrow 10am").`,
    )
  }
  return DateTime.fromObject(
    {
      year: start.get("year") ?? nowInZone.year,
      month: start.get("month") ?? nowInZone.month,
      day: start.get("day") ?? nowInZone.day,
      hour: start.get("hour") ?? 0,
      minute: start.get("minute") ?? 0,
      second: start.get("second") ?? 0,
    },
    { zone },
  )
}

import { describe, it, expect, vi, afterEach } from "vitest"
import { DateTime } from "luxon"
import { parseAttendee } from "../../src/handwritten/utils/parse-attendee.js"
import { parseDateOnly, ParseDateError } from "../../src/handwritten/utils/parse-date.js"
import {
  parseTimeInput,
  parseOccurrenceBoundary,
  parseOccurrenceMutationTimes,
  resolveTimezone,
  ParseTimeError,
} from "../../src/handwritten/utils/parse-time.js"

describe("parseAttendee", () => {
  it("parses 'Name <email>' form", () => {
    expect(parseAttendee("Alice <alice@example.com>")).toEqual({
      email: "alice@example.com",
      display_name: "Alice",
    })
  })

  it("parses bare email", () => {
    expect(parseAttendee("bob@example.com")).toEqual({
      email: "bob@example.com",
    })
  })

  it("treats empty display name as absent", () => {
    expect(parseAttendee("<carol@example.com>")).toEqual({
      email: "carol@example.com",
    })
  })

  it("trims surrounding whitespace", () => {
    expect(parseAttendee("  dan@example.com  ")).toEqual({
      email: "dan@example.com",
    })
  })
})

describe("parseDateOnly", () => {
  it("accepts ISO date", () => {
    expect(parseDateOnly("2026-05-10")).toBe("2026-05-10")
  })

  it("rejects slash-separated date", () => {
    expect(() => parseDateOnly("2026/05/10")).toThrow(ParseDateError)
  })

  it("rejects non-date input", () => {
    expect(() => parseDateOnly("not a date")).toThrow(ParseDateError)
  })

  it("rejects calendar-invalid date", () => {
    expect(() => parseDateOnly("2026-13-40")).toThrow(ParseDateError)
  })
})

describe("resolveTimezone", () => {
  it("prefers explicit flag", () => {
    expect(resolveTimezone("Asia/Tokyo", { WSPC_TZ: "Asia/Taipei" })).toBe("Asia/Tokyo")
  })

  it("falls back to WSPC_TZ env", () => {
    expect(resolveTimezone(undefined, { WSPC_TZ: "Asia/Taipei" })).toBe("Asia/Taipei")
  })

  it("falls back to system zone when neither flag nor env is set", () => {
    const z = resolveTimezone(undefined, {})
    expect(typeof z).toBe("string")
    expect(z.length).toBeGreaterThan(0)
  })
})

describe("parseTimeInput", () => {
  it("parses ISO 8601 with offset and preserves the zone", () => {
    const dt = parseTimeInput("2026-05-12T10:00+08:00", "UTC")
    expect(dt.isValid).toBe(true)
    expect(dt.hour).toBe(10)
    expect(dt.minute).toBe(0)
    // setZone: true preserves the +08:00 offset
    expect(dt.offset).toBe(8 * 60)
  })

  it("parses natural language in the given zone", () => {
    // Freeze time at 2026-05-15 11:00 Taipei (= 03:00 UTC) so "tomorrow"
    // is unambiguously 2026-05-16 in Taipei regardless of host zone.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-15T03:00:00Z"))
    try {
      const dt = parseTimeInput("tomorrow 10am", "Asia/Taipei")
      expect(dt.isValid).toBe(true)
      expect(dt.zoneName).toBe("Asia/Taipei")
      expect(dt.hour).toBe(10)
      expect(dt.minute).toBe(0)
      expect(dt.toISODate()).toBe("2026-05-16")
    } finally {
      vi.useRealTimers()
    }
  })

  it("parses naive ISO in the requested zone (not system zone)", () => {
    // Naive ISO has no offset/Z, so it must be interpreted as wall-clock
    // time in the supplied zone, not the system zone.
    const dt = parseTimeInput("2026-05-12T10:00", "Asia/Taipei")
    expect(dt.isValid).toBe(true)
    expect(dt.zoneName).toBe("Asia/Taipei")
    expect(dt.year).toBe(2026)
    expect(dt.month).toBe(5)
    expect(dt.day).toBe(12)
    expect(dt.hour).toBe(10)
    expect(dt.minute).toBe(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("throws ParseTimeError on empty string", () => {
    expect(() => parseTimeInput("", "UTC")).toThrow(ParseTimeError)
  })

  it("throws ParseTimeError on gibberish", () => {
    expect(() => parseTimeInput("not a real time", "UTC")).toThrow(ParseTimeError)
  })
})

describe("parseOccurrenceBoundary", () => {
  it("preserves an ISO date-only boundary", () => {
    expect(parseOccurrenceBoundary("2026-08-13", "Asia/Taipei")).toBe("2026-08-13")
  })

  it("resolves a timed boundary with the parse-only zone", () => {
    expect(parseOccurrenceBoundary("tomorrow 9am", "Asia/Taipei")).toMatch(/T09:00:00\.000\+08:00$/)
  })
})

describe("all-day occurrence Calendar Dates", () => {
  it("preserves leap-day boundaries and Exclusive End without date math", () => {
    expect(parseOccurrenceBoundary("2028-02-29", "Pacific/Apia")).toBe("2028-02-29")
    expect(parseOccurrenceMutationTimes({ all_day: true }, "2028-02-29", "2028-03-01")).toEqual({
      start: "2028-02-29",
      end: "2028-03-01",
    })
  })

  it.each([
    ["2028/02/29", "2028-03-01"],
    ["2028-02-29", "2028-03-01T00:00:00Z"],
  ])("rejects non-Calendar Date input: %s to %s", (start, end) => {
    expect(() => parseOccurrenceMutationTimes({ all_day: true }, start, end)).toThrow(ParseDateError)
  })

  it("still rejects an explicit time zone for an all-day series", () => {
    expect(() => parseOccurrenceMutationTimes({ all_day: true }, "2028-02-29", "2028-03-01", "UTC"))
      .toThrow("--tz is not valid for an all-day recurring series.")
  })
})

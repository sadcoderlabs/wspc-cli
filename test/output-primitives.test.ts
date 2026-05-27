import { describe, it, expect } from "vitest"
import { idShort, truncate, statusBadge, relativeTime } from "../src/handwritten/output/primitives.js"

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

describe("idShort", () => {
  it("preserves the full id for copy-paste", () => {
    const full = "tod_01HW3K4N9V5G6Z8C2Q7B1Y0M3F"
    const out = idShort(full)
    // Terminal selection picks up visible text without ANSI codes; the full
    // id must round-trip so users can paste it back into another command.
    expect(stripAnsi(out)).toBe(full)
  })

  it("emits a dim escape that splits prefix from suffix", () => {
    // The prefix portion (`tod_` + 8 ULID chars) is rendered un-dimmed; the
    // discriminator suffix is wrapped in the ANSI dim sequence. Colour is
    // gated on TTY detection / NO_COLOR / FORCE_COLOR, so force it on for
    // this assertion — non-TTY test runs would otherwise see plain text.
    const prev = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = "1"
    try {
      const out = idShort("tod_01HW3K4N9V5G6Z8C2Q7B1Y0M3F")
      expect(out.startsWith("tod_01HW3K4N")).toBe(true)
      expect(out).toMatch(/\x1b\[2m/)
    } finally {
      if (prev === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = prev
    }
  })

  it("returns short ids unchanged when nothing to dim", () => {
    expect(idShort("tod_01HW3")).toBe("tod_01HW3")
  })

  it("falls back to first-12 split for prefix-less ids", () => {
    const out = idShort("abcdefghijklmnopqrstuvwxyz")
    expect(stripAnsi(out)).toBe("abcdefghijklmnopqrstuvwxyz")
    expect(out.startsWith("abcdefghijkl")).toBe(true)
  })
})

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("appends ellipsis when over the limit", () => {
    expect(truncate("hello world", 8)).toBe("hello w…")
  })
})

describe("statusBadge", () => {
  it("decorates known statuses", () => {
    expect(stripAnsi(statusBadge("done"))).toBe("✓ done")
    expect(stripAnsi(statusBadge("open"))).toBe("○ open")
    expect(stripAnsi(statusBadge("in_progress"))).toBe("◐ in_progress")
  })

  it("passes unknown statuses through", () => {
    expect(statusBadge("custom")).toBe("custom")
  })
})

describe("relativeTime", () => {
  const NOW = 1_000_000_000_000

  it("formats past timestamps", () => {
    expect(relativeTime(NOW - 2 * 60 * 60 * 1000, NOW)).toBe("2h ago")
    expect(relativeTime(NOW - 3 * 24 * 60 * 60 * 1000, NOW)).toBe("3d ago")
  })

  it("formats future timestamps with `in` prefix", () => {
    expect(relativeTime(NOW + 2 * 60 * 60 * 1000, NOW)).toBe("in 2h")
  })

  it("accepts ISO and date-only strings", () => {
    expect(relativeTime("2001-09-09T01:46:40.000Z", NOW)).toBe("just now")
  })

  it("returns the raw value on parse failure", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("not-a-date")
  })
})

import { describe, it, expect } from "vitest"
import { idShort, truncate, statusBadge, relativeTime, wrapToWidth } from "../src/handwritten/output/primitives.js"

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

describe("wrapToWidth", () => {
  it("keeps a short single line intact", () => {
    expect(wrapToWidth("hello world", 80)).toEqual(["hello world"])
  })

  it("word-wraps English at spaces", () => {
    expect(wrapToWidth("aaa bbb ccc ddd", 7)).toEqual(["aaa bbb", "ccc ddd"])
  })

  it("preserves existing newlines (one wrap per source line)", () => {
    expect(wrapToWidth("para one\n\npara two", 80)).toEqual([
      "para one",
      "",
      "para two",
    ])
  })

  it("hard-breaks a long spaceless CJK run by visible width", () => {
    // 6 full-width chars = width 12; wrap at 6 -> 3 chars per line
    const lines = wrapToWidth("中文字測試串", 6)
    expect(lines).toEqual(["中文字", "測試串"])
  })

  it("counts CJK as width 2 when packing", () => {
    // "中" is width 2; at width 4 only two fit per line
    expect(wrapToWidth("中中中中中", 4)).toEqual(["中中", "中中", "中"])
  })

  it("does not loop forever when width is smaller than one CJK char", () => {
    // "中" is visible width 2; width 1 cannot fit it. Emit it intact rather than hang.
    expect(wrapToWidth("中", 1)).toEqual(["中"])
  })

  it("emits an over-wide single char intact instead of hanging", () => {
    expect(wrapToWidth("中文", 1)).toEqual(["中", "文"])
  })
})

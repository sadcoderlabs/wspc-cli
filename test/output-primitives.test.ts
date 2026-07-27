import { execFileSync } from "node:child_process"
import { describe, it, expect } from "vitest"
import { idShort, red, truncate, statusBadge, relativeTime, visibleWidth, wrapToWidth } from "../src/handwritten/output/primitives.js"
import { stripAnsi } from "./helpers/stdout.js"

interface TerminalOptions {
  isTTY: boolean
  forceColor?: string
  getColorDepth?: () => number
}

function withTerminal(options: TerminalOptions, run: () => void): void {
  const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  const originalGetColorDepth = Object.getOwnPropertyDescriptor(process.stdout, "getColorDepth")
  const originalForceColor = process.env.FORCE_COLOR
  const originalNoColor = process.env.NO_COLOR

  Object.defineProperty(process.stdout, "isTTY", { value: options.isTTY, configurable: true })
  if (options.getColorDepth) {
    Object.defineProperty(process.stdout, "getColorDepth", { value: options.getColorDepth, configurable: true })
  }
  if (options.forceColor === undefined) delete process.env.FORCE_COLOR
  else process.env.FORCE_COLOR = options.forceColor
  delete process.env.NO_COLOR

  try {
    run()
  } finally {
    if (originalTTY === undefined) Reflect.deleteProperty(process.stdout, "isTTY")
    else Object.defineProperty(process.stdout, "isTTY", originalTTY)
    if (originalGetColorDepth === undefined) Reflect.deleteProperty(process.stdout, "getColorDepth")
    else Object.defineProperty(process.stdout, "getColorDepth", originalGetColorDepth)
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = originalForceColor
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
  }
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
    // discriminator suffix is wrapped in the ANSI dim sequence.
    withTerminal({ isTTY: false, forceColor: "1" }, () => {
      const out = idShort("tod_01HW3K4N9V5G6Z8C2Q7B1Y0M3F")
      expect(out.startsWith("tod_01HW3K4N")).toBe(true)
      expect(out).toMatch(/\x1b\[2m/)
    })
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

describe("terminal styling", () => {
  it("leaves non-TTY output plain", () => {
    withTerminal({ isTTY: false }, () => {
      expect(red("alert")).toBe("alert")
    })
  })

  it("honors a no-color stdout capability decision", () => {
    withTerminal({ isTTY: true, getColorDepth: () => 1 }, () => {
      expect(red("alert")).toBe("alert")
    })
  })

  it("honors NO_COLOR on a TTY", () => {
    const primitivesUrl = new URL("../src/handwritten/output/primitives.ts", import.meta.url).href
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { WriteStream } = await import("node:tty"); Object.defineProperties(process.stdout, { isTTY: { value: true }, getColorDepth: { value: WriteStream.prototype.getColorDepth }, hasColors: { value: WriteStream.prototype.hasColors } }); const { red } = await import(${JSON.stringify(primitivesUrl)}); process.stdout.write(red("alert"))`,
      ],
      { env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: "1" } },
    ).toString()

    expect(output).toBe("alert")
  })

  it("honors FORCE_COLOR=0 on a TTY", () => {
    withTerminal({ isTTY: true, forceColor: "0" }, () => {
      expect(red("alert")).toBe("alert")
    })
  })
})

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("appends ellipsis when over the limit", () => {
    expect(truncate("hello world", 8)).toBe("hello w…")
  })

  it("removes terminal control sequences before truncating", () => {
    const hyperlink = "\x1b]8;;https://example.com\x07click here\x1b]8;;\x07"

    expect(truncate(hyperlink, 7)).toBe("click …")
  })
})

describe("visibleWidth", () => {
  it("ignores terminal control sequences beyond color escapes", () => {
    const hyperlink = "\x1b]8;;https://example.com\x07click\x1b]8;;\x07"

    expect(visibleWidth(hyperlink)).toBe(5)
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

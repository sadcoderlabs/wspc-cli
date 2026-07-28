/**
 * Lightweight ANSI + table primitives shared by all renderers. No external
 * dependencies — keep it that way; the CLI's value prop is being a small
 * single-file install. Anything that needs heavy formatting belongs in a
 * specific renderer, not here.
 */

import { stripVTControlCharacters, styleText } from "node:util"
import { DateTime } from "luxon"

// ---------- colour / weight ----------

function style(format: Parameters<typeof styleText>[0], s: string): string {
  return styleText(format, s, { stream: process.stdout, validateStream: true })
}

export const dim = (s: string): string => style("dim", s)
export const bold = (s: string): string => style("bold", s)
export const green = (s: string): string => style("green", s)
export const yellow = (s: string): string => style("yellow", s)
export const red = (s: string): string => style("red", s)
export const gray = (s: string): string => style("gray", s)
export const cyan = (s: string): string => style("cyan", s)

export function colorise(s: string, color?: string): string {
  switch (color) {
    case "green":
      return green(s)
    case "yellow":
      return yellow(s)
    case "red":
      return red(s)
    case "gray":
      return gray(s)
    case "cyan":
      return cyan(s)
    case "dim":
      return dim(s)
    case "bold":
      return bold(s)
    default:
      return s
  }
}

// ---------- value formatters ----------

/** Count visible width ignoring ANSI codes. CJK width approximated as 2. */
export function visibleWidth(s: string): number {
  const stripped = stripVTControlCharacters(s)
  let w = 0
  for (const ch of stripped) {
    const code = ch.codePointAt(0)!
    // Rough CJK detection — sufficient for column alignment of titles/labels
    // that may mix English with Chinese; we don't aim for full UAX #11 here.
    if (code >= 0x1100 && code <= 0x115f) w += 2
    else if (code >= 0x2e80 && code <= 0x9fff) w += 2
    else if (code >= 0xac00 && code <= 0xd7a3) w += 2
    else if (code >= 0xf900 && code <= 0xfaff) w += 2
    else if (code >= 0xff00 && code <= 0xff60) w += 2
    else if (code >= 0xffe0 && code <= 0xffe6) w += 2
    else w += 1
  }
  return w
}

function padEndVisible(s: string, target: number): string {
  const w = visibleWidth(s)
  if (w >= target) return s
  return s + " ".repeat(target - w)
}

/**
 * Truncate to `max` *visible* width, appending `…`. Ignores any ANSI escapes
 * (callers should pass raw strings; styling should wrap the truncated result).
 */
export function truncate(s: string, max = 50): string {
  if (visibleWidth(s) <= max) return s
  let out = ""
  let w = 0
  for (const ch of stripVTControlCharacters(s)) {
    const cw = visibleWidth(ch)
    if (w + cw + 1 > max) break
    out += ch
    w += cw
  }
  return out + "…"
}

/**
 * Render an id with visual emphasis on the scannable prefix while keeping
 * the full id intact for copy-paste — `tod_01HW3K4N` shown normally,
 * `9V5G6Z8C2Q7B1Y0M3F` dimmed. Terminal text selection still picks up the
 * whole string so users can copy from the table directly and use it as a
 * parameter to other commands.
 *
 * Naming note: the spec contract key is `"id-short"` for historical reasons
 * (the original implementation truncated). The wire name is kept stable so
 * the spec doesn't churn; the behaviour evolved when truncation turned out
 * to bite users who copied the visible prefix and got a NOT_FOUND.
 */
export function idShort(s: string): string {
  if (!s) return s
  const us = s.indexOf("_")
  const prefixEnd = us >= 0 ? us + 9 : 12
  if (s.length <= prefixEnd) return s
  return s.slice(0, prefixEnd) + dim(s.slice(prefixEnd))
}

/**
 * Common todo / task status enums → icon + colour. Unknown values fall
 * through to the raw string so the spec can add new statuses without
 * shipping a CLI bump first.
 */
export function statusBadge(s: string): string {
  switch (s) {
    case "open":
      return gray("○ open")
    case "in_progress":
      return yellow("◐ in_progress")
    case "done":
      return green("✓ done")
    case "cancelled":
    case "canceled":
      return red("✕ " + s)
    default:
      return s
  }
}

/**
 * Render a boolean flag (e.g. `is_read`) as a dim "read" / bright "unread"
 * badge. Accepts the raw boolean rather than a string so the format applies
 * cleanly to JSON-shaped data.
 */
export function boolBadge(value: unknown): string {
  if (value === true) return dim("✓ read")
  if (value === false) return "● unread"
  return String(value)
}

/**
 * Render an Instant as relative time. Accepts epoch-ms numbers or ISO 8601
 * strings with an explicit offset. Calendar Dates and invalid values stay raw
 * so the formatter never invents a timezone for incomplete input.
 */
export function relativeTime(value: unknown, now: number = Date.now()): string {
  let instant: DateTime
  if (typeof value === "number") {
    instant = DateTime.fromMillis(value)
  } else if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = DateTime.fromISO(value)
      if (date.isValid && date.toISODate() === value) return value
    }
    if (!/[Tt].*(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(value)) return value
    instant = DateTime.fromISO(value, { setZone: true })
  } else {
    return String(value)
  }
  const current = DateTime.fromMillis(now)
  if (!instant.isValid || !current.isValid) return String(value)
  const diff = instant.diff(current).as("milliseconds")
  const abs = Math.abs(diff)
  const future = diff > 0

  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  const WEEK = 7 * DAY
  const MONTH = 30 * DAY

  let amount: number
  let unit: string
  if (abs < MINUTE) return "just now"
  if (abs < HOUR) {
    amount = Math.round(abs / MINUTE)
    unit = "m"
  } else if (abs < DAY) {
    amount = Math.round(abs / HOUR)
    unit = "h"
  } else if (abs < WEEK) {
    amount = Math.round(abs / DAY)
    unit = "d"
  } else if (abs < MONTH) {
    amount = Math.round(abs / WEEK)
    unit = "w"
  } else {
    amount = Math.round(abs / MONTH)
    unit = "mo"
  }
  return future ? `in ${amount}${unit}` : `${amount}${unit} ago`
}

/**
 * Wrap `text` to `width` visible columns, returning one string per output
 * line. Existing newlines in `text` are preserved (each source line is wrapped
 * independently, blank lines kept). English wraps at spaces; a single token
 * wider than `width` (long URLs, spaceless CJK runs) is hard-broken by visible
 * width using the same `visibleWidth` ruler the tables use, so CJK columns line
 * up the same way they do elsewhere. No external dependency by design.
 *
 * `width` is the visible-column budget; values <= 0 fall back to 80. A token
 * wider than `width` is broken one max-fitting chunk at a time (at least one
 * character per line, so wrapping always progresses).
 */
export function wrapToWidth(text: string, width: number): string[] {
  const limit = width > 0 ? width : 80
  const out: string[] = []
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      out.push("")
      continue
    }
    let cur = ""
    for (let word of line.split(" ")) {
      // Hard-break a word that cannot fit on a line by itself.
      while (visibleWidth(word) > limit) {
        let head = ""
        for (const ch of word) {
          if (head && visibleWidth(head + ch) > limit) break
          head += ch
          if (visibleWidth(head) >= limit) break
        }
        if (cur) {
          out.push(cur)
          cur = ""
        }
        out.push(head)
        word = word.slice(head.length)
      }
      const sep = cur ? " " : ""
      if (cur && visibleWidth(cur + sep + word) > limit) {
        out.push(cur)
        cur = word
      } else {
        cur = cur + sep + word
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

// ---------- table ----------

/**
 * Render an aligned text table to a string (with trailing newline). Column
 * widths are chosen from the widest visible content per column. Caller is
 * responsible for any pre-formatting (truncation, colour, badges).
 */
export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return ""
  }
  const widths: number[] = headers.map((h, i) => {
    let w = visibleWidth(h)
    for (const r of rows) {
      const cell = r[i] ?? ""
      const cw = visibleWidth(cell)
      if (cw > w) w = cw
    }
    return w
  })
  const sep = "  "
  const lines: string[] = []
  // Header: dimmed, uppercase already supplied by caller.
  lines.push(headers.map((h, i) => dim(padEndVisible(h, widths[i] ?? 0))).join(sep))
  for (const r of rows) {
    lines.push(r.map((c, i) => padEndVisible(c ?? "", widths[i] ?? 0)).join(sep))
  }
  return lines.join("\n") + "\n"
}

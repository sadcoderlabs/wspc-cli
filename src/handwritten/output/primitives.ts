/**
 * Lightweight ANSI + table primitives shared by all renderers. No external
 * dependencies — keep it that way; the CLI's value prop is being a small
 * single-file install. Anything that needs heavy formatting belongs in a
 * specific renderer, not here.
 */

const ESC = "\x1b["

// ---------- colour / weight ----------

/** Honour NO_COLOR (https://no-color.org) and non-TTY destinations. */
function colourEnabled(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return !!process.stdout.isTTY
}

function wrap(code: string, s: string): string {
  if (!colourEnabled()) return s
  return `${ESC}${code}m${s}${ESC}0m`
}

export const dim = (s: string): string => wrap("2", s)
export const bold = (s: string): string => wrap("1", s)
export const green = (s: string): string => wrap("32", s)
export const yellow = (s: string): string => wrap("33", s)
export const red = (s: string): string => wrap("31", s)
export const gray = (s: string): string => wrap("90", s)
export const cyan = (s: string): string => wrap("36", s)

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

const ANSI_RE = /\x1b\[[0-9;]*m/g

/** Count visible width ignoring ANSI codes. CJK width approximated as 2. */
export function visibleWidth(s: string): number {
  const stripped = s.replace(ANSI_RE, "")
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
  // Trim character-by-character. Not perfect for embedded ANSI mid-string,
  // but format hints today only colour the cell wholesale.
  let out = ""
  let w = 0
  for (const ch of s.replace(ANSI_RE, "")) {
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
 * Render a timestamp as relative time. Accepts epoch-ms numbers (preferred —
 * matches the wspc API convention), ISO 8601 strings, or date-only strings.
 * Returns the raw input on parse failure rather than throwing, so a bad cell
 * doesn't crash the whole table.
 */
export function relativeTime(value: unknown, now: number = Date.now()): string {
  let ms: number
  if (typeof value === "number") {
    ms = value
  } else if (typeof value === "string") {
    // Accept "2026-06-01" (date-only) and full ISO; both parse via Date.
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return value
    ms = parsed
  } else {
    return String(value)
  }
  const diff = ms - now
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

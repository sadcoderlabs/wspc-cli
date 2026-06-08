/**
 * Output dispatch entry point. Generated CLI commands call `render({ kind,
 * display }, data)` instead of dumping JSON directly. The dispatcher walks a
 * three-tier fallback chain:
 *
 *   1. Specific renderer registered for `kind`           (handwritten, opt-in)
 *   2. Generic renderer driven by spec `display` hints   (covers most ops)
 *   3. Generic renderer with schema-shape auto-detect    (no hints needed)
 *   4. JSON                                              (final safety net)
 *
 * JSON is also forced when output is being piped/redirected, when the user
 * passes `--json`, or via `WSPC_OUTPUT=json` — so machine consumers and AI
 * agents always get a parseable shape regardless of which tier handled the
 * pretty path.
 */

import {
  boolBadge,
  colorise,
  dim,
  green,
  idShort,
  relativeTime,
  statusBadge,
  table,
  truncate,
  visibleWidth,
  wrapToWidth,
} from "./primitives.js"
import type {
  RenderContext,
  Renderer,
  XCliDisplay,
  XCliFormat,
} from "./types.js"

/**
 * Registry of specific renderers, keyed by `kind`. Intentionally empty at
 * boot — register from a side-effecting module (`renderers/index.ts`) when
 * we need custom output for a specific operation. Until then, every command
 * flows through the generic renderer.
 */
const SPECIFIC_RENDERERS: Record<string, Renderer> = {}

/** Public API for tests / future bootstrap modules to plug renderers in. */
export function registerRenderer(kind: string, renderer: Renderer): void {
  SPECIFIC_RENDERERS[kind] = renderer
}

export function render(ctx: RenderContext, data: unknown): void {
  if (data === undefined) return
  // `raw` shape is for passthrough payloads like `.ics` text where any
  // wrapping (JSON quoting, table, key/value) would corrupt the content.
  // It wins over both TTY auto-detection and explicit `--json`/WSPC_OUTPUT
  // because the upstream HTTP body is already the user-facing artifact;
  // re-encoding it as a JSON string is never what the caller wants.
  if (ctx.display?.shape === "raw") {
    const s = typeof data === "string" ? data : String(data)
    process.stdout.write(s)
    if (!s.endsWith("\n")) process.stdout.write("\n")
    return
  }
  if (shouldOutputJson()) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n")
    return
  }
  // Drill into the wrapper key for pretty mode only. JSON output above
  // intentionally preserves the full server payload.
  const target = drillDataPath(data, ctx.display?.dataPath)
  const specific = SPECIFIC_RENDERERS[ctx.kind]
  if (specific) {
    specific(target, ctx.display)
    return
  }
  renderGeneric(target, ctx.display)
}

function drillDataPath(data: unknown, dataPath: string | undefined): unknown {
  if (!dataPath) return data
  if (data === null || typeof data !== "object") return data
  const value = (data as Record<string, unknown>)[dataPath]
  // If the wrapper key is missing, fall back to the original payload so the
  // user still sees something useful instead of "undefined".
  return value === undefined ? data : value
}

function shouldOutputJson(): boolean {
  // Explicit overrides win over TTY detection so users can force either
  // mode in CI logs, screenshots, captured output, or AI-driven tooling.
  if (process.env.WSPC_OUTPUT === "json") return true
  if (process.env.WSPC_OUTPUT === "pretty") return false
  // The codegen wires `--json` to flip WSPC_OUTPUT=json before the action.
  if (!process.stdout.isTTY) {
    // Pipe / redirect — machine consumer. Default to JSON so scripts /
    // `jq` / AI agents get a parseable shape without opting in.
    return true
  }
  return false
}

// ---------- generic renderer ----------

function termWidth(): number {
  const c = process.stdout.columns
  return typeof c === "number" && c > 0 ? c : 80
}

function renderGeneric(data: unknown, hints?: XCliDisplay): void {
  const shape = hints?.shape ?? detectShape(data)
  if (shape === "list") {
    renderList(data, hints)
  } else if (shape === "object") {
    renderObject(data, hints)
  } else {
    renderScalar(data)
  }
}

function detectShape(data: unknown): "list" | "object" | "scalar" {
  if (Array.isArray(data)) return "list"
  if (typeof data === "object" && data !== null) {
    // wspc list responses wrap items in a single array property, e.g.
    // `{ todos: [...] }` or `{ projects: [...] }`. We treat any object with
    // exactly one array-valued top-level key as a list.
    const keys = Object.keys(data)
    const arrayKeys = keys.filter((k) => Array.isArray((data as Record<string, unknown>)[k]))
    if (arrayKeys.length === 1) return "list"
    return "object"
  }
  return "scalar"
}

function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (typeof data === "object" && data !== null) {
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) return v
    }
  }
  return []
}

function renderList(data: unknown, hints?: XCliDisplay): void {
  const items = extractItems(data)
  if (items.length === 0) {
    process.stdout.write(dim("  " + (hints?.emptyMessage ?? "no items")) + "\n")
    return
  }
  const first = items[0] as Record<string, unknown>
  const columns = pickColumns(first, hints?.columns)
  const format = hints?.format ?? {}
  const headers = columns.map((c) => c.toUpperCase())
  const rows = items.map((item) =>
    columns.map((col) =>
      formatCell((item as Record<string, unknown>)[col], format[col], hints?.enumColorMap?.[col]),
    ),
  )
  process.stdout.write(table(headers, rows))
}

function pickColumns(first: Record<string, unknown>, hint?: string[]): string[] {
  if (hint && hint.length > 0) return hint.filter((c) => c in first)
  // Auto-pick: prefer well-known leading fields, then any other scalar field,
  // capped at 5 to avoid runaway-wide tables.
  const PREFERRED = ["id", "name", "title", "label", "status", "due_at", "created_at"]
  const present = new Set(Object.keys(first))
  const ordered = [
    ...PREFERRED.filter((k) => present.has(k) && isScalar(first[k])),
    ...Object.keys(first).filter(
      (k) => !PREFERRED.includes(k) && isScalar(first[k]),
    ),
  ]
  return ordered.slice(0, 5)
}

/**
 * Render an object as key/value rows (two-space indent). Exported so
 * handwritten renderers (e.g. `wspc whoami`) can compose multiple object
 * sections without re-implementing the field/format pipeline.
 */
export function renderObject(data: unknown, hints?: XCliDisplay): void {
  if (typeof data !== "object" || data === null) {
    renderScalar(data)
    return
  }
  // Many wspc responses wrap the resource in a single-key envelope
  // (`{ todo: {...} }`). Peel one level so the user sees fields directly.
  let obj = data as Record<string, unknown>
  const topKeys = Object.keys(obj)
  if (topKeys.length === 1) {
    const onlyKey = topKeys[0] as string
    const inner = obj[onlyKey]
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      obj = inner as Record<string, unknown>
    }
  }
  const fields =
    hints?.fields?.filter((f) => f in obj) ??
    Object.keys(obj).filter((k) => isScalar(obj[k]))
  if (fields.length === 0) {
    // Nothing scalar to show — fall through to JSON so the user still sees
    // something useful instead of an empty block.
    process.stdout.write(JSON.stringify(obj, null, 2) + "\n")
    return
  }
  const format = hints?.format ?? {}
  // When user explicitly whitelisted fields, respect that and skip arrays.
  // Otherwise show array fields as indented sub-lists after the scalar rows
  // so users see attendees / tags / etc. without resorting to --json.
  const arrayFields = hints?.fields
    ? []
    : Object.keys(obj).filter(
        (k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0,
      )

  // Format every scalar field up front (object mode never truncates), then
  // classify: short single-line values stay as aligned two-column rows; values
  // with newlines or wider than the available column go to indented blocks
  // rendered last, so the compact id/status/timestamp rows stay scannable.
  const formatted: Array<[string, string]> = fields.map((f) => [
    f,
    formatCell(obj[f], format[f], hints?.enumColorMap?.[f], { noTruncate: true }),
  ])
  const labelWidth = Math.max(
    ...formatted.map(([f]) => f.length),
    ...arrayFields.map((f) => f.length),
    0,
  )
  const tw = termWidth()
  const avail = tw - (2 + labelWidth + 2)
  const inlineFinal: Array<[string, string]> = []
  const blocks: Array<[string, string]> = []
  for (const [f, value] of formatted) {
    if (value.includes("\n") || visibleWidth(value) > avail) {
      blocks.push([f, value])
    } else {
      inlineFinal.push([f, value])
    }
  }

  for (const [f, value] of inlineFinal) {
    process.stdout.write(`  ${dim(f.padEnd(labelWidth))}  ${value}\n`)
  }
  for (const f of arrayFields) {
    renderArrayField(f, obj[f] as unknown[], labelWidth)
  }
  const hadAbove = inlineFinal.length > 0 || arrayFields.length > 0
  blocks.forEach(([f, value], i) => {
    if (hadAbove || i > 0) process.stdout.write("\n")
    process.stdout.write(`  ${dim(f)}\n`)
    for (const line of wrapToWidth(value, tw - 4)) {
      process.stdout.write(`    ${line}\n`)
    }
  })
  if (hints?.secretField) {
    const value = obj[hints.secretField]
    if (value !== undefined) {
      process.stdout.write("\n")
      process.stdout.write(colorise("⚠  This is the only time you'll see this key. Save it now.", "yellow") + "\n")
      process.stdout.write("\n")
      process.stdout.write("   To use it as the active env credential:\n")
      process.stdout.write(`     wspc env add <name> --api-key ${value}\n`)
    }
  }
}

const ARRAY_FIELD_MAX_ITEMS = 10

function renderArrayField(
  name: string,
  items: unknown[],
  labelWidth: number,
): void {
  const count = items.length
  const header = `${count} ${count === 1 ? "item" : "items"}`
  process.stdout.write(`  ${dim(name.padEnd(labelWidth))}  ${header}\n`)
  const shown = items.slice(0, ARRAY_FIELD_MAX_ITEMS)
  shown.forEach((item, i) => {
    process.stdout.write(`    ${dim(`${i + 1}.`)} ${formatArrayItem(item)}\n`)
  })
  if (count > shown.length) {
    process.stdout.write(`    ${dim(`... and ${count - shown.length} more`)}\n`)
  }
}

function formatArrayItem(item: unknown): string {
  if (item === null) return dim("null")
  if (typeof item !== "object") return String(item)
  const attendee = formatAttendeeLike(item)
  if (attendee !== null) return attendee
  return JSON.stringify(item)
}

/**
 * Recognize the common `{ email, display_name? }` attendee shape and render
 * it the way humans expect ("Alice <alice@example.com>"). Returns null when
 * the input doesn't look like an attendee so the caller can fall back to
 * compact JSON.
 */
function formatAttendeeLike(item: unknown): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null
  const rec = item as Record<string, unknown>
  const email = typeof rec.email === "string" ? rec.email : null
  if (!email) return null
  const name =
    typeof rec.display_name === "string" && rec.display_name.length > 0
      ? rec.display_name
      : null
  return name ? `${name} <${email}>` : `<${email}>`
}

function renderScalar(data: unknown): void {
  if (data === null) {
    process.stdout.write(dim("null") + "\n")
    return
  }
  if (typeof data === "boolean") {
    process.stdout.write((data ? green("true") : dim("false")) + "\n")
    return
  }
  if (typeof data === "object") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n")
    return
  }
  process.stdout.write(String(data) + "\n")
}

function isScalar(v: unknown): boolean {
  return v === null || (typeof v !== "object" && typeof v !== "function")
}

function formatCell(
  value: unknown,
  fmt?: XCliFormat,
  colorMap?: Record<string, { label: string; color: string }>,
  opts?: { noTruncate?: boolean },
): string {
  if (fmt !== "enum-badge" && (value === undefined || value === null)) return dim("—")
  switch (fmt) {
    case "id-short":
      return idShort(String(value))
    case "status-badge":
      return statusBadge(String(value))
    case "relative-time":
      return relativeTime(value)
    case "truncate":
      // `truncate` is a list/column-width hint only. In object (`show`) mode the
      // caller passes noTruncate so single-item views render the full value.
      return opts?.noTruncate ? String(value) : truncate(String(value), 50)
    case "bool-badge":
      return boolBadge(value)
    case "enum-badge": {
      const map = colorMap ?? {}
      const key = (value === null || value === undefined) ? "null" : String(value)
      const entry = map[key] ?? map["*"]
      if (!entry) {
        return value === undefined || value === null ? dim("—") : String(value)
      }
      const label = entry.label.replace("<value>", String(value))
      return colorise(label, entry.color)
    }
    default:
      if (typeof value === "object") return JSON.stringify(value)
      return String(value)
  }
}

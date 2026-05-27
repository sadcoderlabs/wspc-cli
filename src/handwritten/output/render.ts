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
  dim,
  green,
  idShort,
  relativeTime,
  statusBadge,
  table,
  truncate,
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
  if (shouldOutputJson()) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n")
    return
  }
  const specific = SPECIFIC_RENDERERS[ctx.kind]
  if (specific) {
    specific(data, ctx.display)
    return
  }
  renderGeneric(data, ctx.display)
}

function shouldOutputJson(): boolean {
  if (process.env.WSPC_OUTPUT === "json") return true
  // The codegen will surface `--json` as a commander option that flips this
  // env var before the action runs; setting via env keeps the renderer pure.
  if (!process.stdout.isTTY) {
    // Pipe / redirect — machine consumer. We default to *pretty* per spec
    // (user explicitly chose pretty-by-default), but still emit JSON when
    // output is captured so scripts / `jq` / AI agents don't have to opt in.
    return true
  }
  return false
}

// ---------- generic renderer ----------

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
      formatCell((item as Record<string, unknown>)[col], format[col]),
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

function renderObject(data: unknown, hints?: XCliDisplay): void {
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
  const maxKey = Math.max(...fields.map((f) => f.length))
  for (const f of fields) {
    const value = formatCell(obj[f], format[f])
    process.stdout.write(`  ${dim(f.padEnd(maxKey))}  ${value}\n`)
  }
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

function formatCell(value: unknown, fmt?: XCliFormat): string {
  if (value === undefined || value === null) return dim("—")
  switch (fmt) {
    case "id-short":
      return idShort(String(value))
    case "status-badge":
      return statusBadge(String(value))
    case "relative-time":
      return relativeTime(value)
    case "truncate":
      return truncate(String(value), 50)
    default:
      if (typeof value === "object") return JSON.stringify(value)
      return String(value)
  }
}

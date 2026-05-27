/**
 * Mirrors `XCliDisplay` from `@wspc/api-kit`. We don't depend on api-kit
 * directly because wspc-cli is published independently — instead, this file
 * is the wire contract. Keep field names and semantics aligned with
 * packages/shared/api-kit/src/strict-route.ts; the codegen reads `display`
 * out of `openapi.json` and forwards it here verbatim.
 */
export interface XCliDisplay {
  shape?: "list" | "object" | "scalar" | "raw"
  columns?: string[]
  fields?: string[]
  format?: Record<string, XCliFormat>
  emptyMessage?: string
  /**
   * Single-level key the pretty renderer drills into before applying the rest
   * of the hint. Use when the response is a wrapper (e.g. `GET /email/
   * messages/{id}` returns `{ email, attachments }` — `dataPath: "email"`
   * makes pretty mode render the email's fields directly). JSON output is
   * unaffected — the full server payload always prints in `--json` mode so
   * scripts / `jq` see everything.
   */
  dataPath?: string
  enumColorMap?: Record<string, Record<string, { label: string; color: string }>>
}

/**
 * Well-known formatter ids. Renderers must ignore unknown values (forward-
 * compat: spec may introduce new formats before CLI ships support).
 */
export type XCliFormat =
  | "id-short"
  | "status-badge"
  | "relative-time"
  | "truncate"
  | "bool-badge"
  | "enum-badge"

/**
 * Stable identifier tying a generated CLI command to an output renderer.
 * Derived from `operationId` (snake → dot), e.g. `todo_list` → `"todo.list"`.
 * Used to look up specific renderers in the registry; falls back to generic
 * renderer (then JSON) when no specific renderer is registered.
 */
export type RenderKind = string

export interface RenderContext {
  kind: RenderKind
  display?: XCliDisplay
}

/**
 * Specific renderer for a given `kind`. Implementations should write directly
 * to `process.stdout` and return nothing. Receive the same `display` hints
 * the generic renderer would, in case they want to combine custom formatting
 * with spec-driven column choices.
 */
export type Renderer = (data: unknown, display?: XCliDisplay) => void

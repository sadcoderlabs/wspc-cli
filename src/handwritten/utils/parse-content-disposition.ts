/**
 * Extract the `filename=` token from a Content-Disposition header.
 * Supports both quoted (`filename="x.pdf"`) and unquoted (`filename=x.pdf`)
 * tokens. RFC 5987 `filename*=UTF-8''...` is NOT supported in v1 — the
 * server does not currently emit it.
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | undefined {
  if (!header) return undefined
  if (!header.toLowerCase().startsWith("attachment")) return undefined
  const quoted = header.match(/filename="([^"]*)"/i)
  const unquoted = header.match(/filename=([^;\s]+)/i)
  const filename = quoted?.[1] ?? unquoted?.[1]
  if (!filename || filename === "." || filename === "..") return undefined
  if (filename.includes("/") || filename.includes("\\")) return undefined
  return filename
}

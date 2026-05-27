import { extname } from "node:path"

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  ics: "text/calendar",
  zip: "application/zip",
}

/**
 * Map a filename's extension to a likely MIME type, falling back to
 * `application/octet-stream` for unknown extensions. The table is small on
 * purpose — `wspc-cli` deliberately avoids the `mime-types` dependency. Add
 * entries only when a real user complaint surfaces.
 */
export function mimeFromExt(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

import { posix as pathPosix } from "node:path"
import { TextDecoder } from "node:util"
import { diff3Merge } from "node-diff3"

export type ConflictSide = "remote" | "local"
export type MergeTextClassification = { mergeable: true; text: string } | { mergeable: false; reason: string }
export type MergeTextResult = { clean: true; text: string } | { clean: false }

const MAX_MERGE_TEXT_BYTES = 1024 * 1024
const SNIFF_BYTES = 8192
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".xml",
  ".svg",
])

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })

export function classifyMergeText(path: string, bytes: Uint8Array, mimeType?: string): MergeTextClassification {
  if (bytes.byteLength > MAX_MERGE_TEXT_BYTES) {
    return { mergeable: false, reason: "too_large" }
  }

  if (hasBinaryControlBytes(bytes)) {
    return { mergeable: false, reason: "binary" }
  }

  let text: string
  try {
    text = UTF8_DECODER.decode(bytes)
  } catch {
    return { mergeable: false, reason: "invalid_utf8" }
  }

  if (!hasTextHint(path, mimeType)) {
    return { mergeable: false, reason: "not_text" }
  }

  return { mergeable: true, text }
}

export function mergeText3(base: string, local: string, remote: string): MergeTextResult {
  const localNewline = local.includes("\r\n") ? "\r\n" : "\n"
  const regions = diff3Merge(normalizeLines(local), normalizeLines(base), normalizeLines(remote))
  const mergedLines: string[] = []

  for (const region of regions) {
    if (region.conflict !== undefined && region.conflict.o.length === 0) {
      mergedLines.push(...region.conflict.a, ...region.conflict.b)
      continue
    }
    if (region.conflict !== undefined) {
      return { clean: false }
    }
    if (region.ok !== undefined) {
      mergedLines.push(...region.ok)
    }
  }

  return { clean: true, text: mergedLines.join(localNewline) }
}

export function conflictCopyPath(path: string, side: ConflictSide, now: Date, versionId: string): string {
  const parsed = pathPosix.parse(path)
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const shortVersionId = safeShortVersionId(versionId)
  const fileName = `${parsed.name}.${side}-conflict-${timestamp}-${shortVersionId}${parsed.ext}`

  if (parsed.dir === "") {
    return fileName
  }
  return pathPosix.join(parsed.dir, fileName)
}

function hasBinaryControlBytes(bytes: Uint8Array): boolean {
  const sniffLength = Math.min(bytes.byteLength, SNIFF_BYTES)
  for (let index = 0; index < sniffLength; index += 1) {
    const byte = bytes[index]
    if (byte === undefined) {
      continue
    }
    if (byte === 0) {
      return true
    }
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      return true
    }
  }
  return false
}

function hasTextHint(path: string, mimeType?: string): boolean {
  const extension = pathPosix.extname(path).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) || mimeType?.toLowerCase().startsWith("text/") === true
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

function safeShortVersionId(versionId: string): string {
  const safeVersionId = versionId.replace(/[^A-Za-z0-9_-]/g, "_")
  return (safeVersionId.length > 0 ? safeVersionId : "unknown").slice(0, 8)
}

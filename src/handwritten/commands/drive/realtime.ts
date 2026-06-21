import type { DriveRealtimeState } from "./state.js"

export type DriveRealtimeMessage =
  | { type: "ready"; cursor?: string; replayed: number }
  | { type: "library_changed"; cursor?: string; path?: string }
  | { type: "resync_required"; cursor?: string; reason?: string }
  | { type: "error"; code?: string; message?: string }
  | { type: "unknown"; message_type?: string }

export function buildDriveRealtimeUrl(baseUrl: string, libraryId: string, realtime: DriveRealtimeState): URL {
  if (realtime.client_id.length === 0) {
    throw new Error("drive realtime client_id is required")
  }
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  url.pathname = `/drive/libraries/${encodeURIComponent(libraryId)}/realtime`
  url.search = ""
  if (realtime.last_cursor !== undefined) {
    url.searchParams.set("cursor", realtime.last_cursor)
  }
  url.searchParams.set("client_id", realtime.client_id)
  return url
}

export function parseDriveRealtimeMessage(raw: string): DriveRealtimeMessage {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { type: "unknown" }
  }
  if (!isRecord(value)) {
    return { type: "unknown" }
  }

  const messageType = typeof value.type === "string" ? value.type : undefined
  const cursor = typeof value.cursor === "string" ? value.cursor : undefined
  if (messageType === "ready") {
    return optionalString({ type: "ready", replayed: typeof value.replayed === "number" ? value.replayed : 0 }, "cursor", cursor)
  }
  if (messageType === "library_changed") {
    return optionalString(optionalString({ type: "library_changed" }, "cursor", cursor), "path", value.path)
  }
  if (messageType === "resync_required") {
    return optionalString(optionalString({ type: "resync_required" }, "cursor", cursor), "reason", value.reason)
  }
  if (messageType === "error") {
    return optionalString(
      optionalString({ type: "error" }, "code", value.code),
      "message",
      typeof value.message === "string" ? redactedRealtimeError(value.message) : undefined,
    )
  }
  return optionalString({ type: "unknown" }, "message_type", messageType)
}

export function redactedRealtimeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const status = text.match(/\bHTTP\s+(401|403|429|5\d\d)\b/i)
  if (status?.[1] !== undefined) {
    return `HTTP ${status[1]}`
  }
  if (/\bauth|authorization\b/i.test(text)) {
    return "auth failed"
  }
  if (/\bnetwork|fetch|close\b/i.test(text)) {
    return "network error"
  }
  return "realtime error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString<T extends object, K extends string>(target: T, key: K, value: unknown): T | (T & Record<K, string>) {
  if (typeof value !== "string") {
    return target
  }
  return { ...target, [key]: value } as T & Record<K, string>
}

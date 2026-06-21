import type { DriveRealtimeState } from "./state.js"
import type { DriveRealtimeSource } from "./watch.js"

export type DriveRealtimeMessage =
  | { type: "ready"; cursor?: string; replayed: number }
  | { type: "library_changed"; cursor?: string; path?: string }
  | { type: "resync_required"; cursor?: string; reason?: string }
  | { type: "error"; code?: string; message?: string }
  | { type: "unknown"; message_type?: string }

export interface DriveRealtimeConnectorInit {
  headers?: HeadersInit
}

export type DriveRealtimeConnector = (url: URL, handlers: {
  open: () => void
  message: (data: string) => void
  close: (error?: unknown) => void
}, init?: DriveRealtimeConnectorInit) => { close: () => void }

type DriveRealtimeHandlers = Parameters<DriveRealtimeSource["start"]>[0]

export function createDriveRealtimeSource(args: {
  baseUrl: string
  libraryId: string
  realtime: DriveRealtimeState
  writeRealtimeState: (next: DriveRealtimeState) => Promise<void>
  connect?: DriveRealtimeConnector
  headers?: HeadersInit
  now?: () => Date
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}): DriveRealtimeSource {
  const connect = args.connect ?? nativeWebSocketConnector
  const now = args.now ?? (() => new Date())
  const scheduleTimeout = args.setTimeout ?? setTimeout
  const cancelTimeout = args.clearTimeout ?? clearTimeout
  let currentRealtime = { ...args.realtime }
  let handlers: DriveRealtimeHandlers | undefined
  let activeSocket: { close: () => void } | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectDelayMs = 1000
  let stopped = false
  let authFailed = false
  let connectionId = 0

  function clearReconnectTimer(): void {
    if (reconnectTimer === undefined) return
    cancelTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  async function persist(next: DriveRealtimeState): Promise<void> {
    currentRealtime = next
    await args.writeRealtimeState(next)
  }

  async function persistBestEffort(next: DriveRealtimeState): Promise<void> {
    try {
      await persist(next)
    } catch (error) {
      handlers?.onWarning?.(redactedRealtimeError(error))
    }
  }

  function connectNow(): void {
    if (stopped || authFailed) return
    clearReconnectTimer()
    const id = ++connectionId
    const url = buildDriveRealtimeUrl(args.baseUrl, args.libraryId, currentRealtime)
    activeSocket = connect(url, {
      open() {
        if (id !== connectionId || stopped || authFailed) return
        reconnectDelayMs = 1000
        void persistBestEffort({ ...currentRealtime, last_connected_at: now().toISOString() })
          .then(() => handlers?.onConnected())
      },
      message(data) {
        if (id !== connectionId || stopped || authFailed) return
        void handleMessage(data).catch((error) => handlers?.onWarning?.(redactedRealtimeError(error)))
      },
      close(error) {
        closeConnection(id, error ?? "close")
      },
    }, args.headers === undefined ? undefined : { headers: args.headers })
  }

  function closeConnection(id: number, error: unknown): void {
    if (id !== connectionId || stopped || authFailed) return
    connectionId += 1
    const socket = activeSocket
    activeSocket = undefined
    clearReconnectTimer()
    socket?.close()
    if (isRealtimeAuthError(error)) {
      authFailed = true
      handlers?.onAuthFailed(redactedRealtimeError(error))
      return
    }
    const delayMs = reconnectDelayMs
    handlers?.onReconnect(delayMs, redactedRealtimeError(error))
    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = undefined
      connectNow()
    }, delayMs)
    reconnectDelayMs = Math.min(delayMs * 2, 60_000)
  }

  async function handleMessage(data: string): Promise<void> {
    const message = parseDriveRealtimeMessage(data)
    if (message.type === "ready") {
      if (message.replayed > 0) {
        handlers?.onEvent(optionalString({ debounce_ms: 2000, reason: "ready_replay" }, "cursor", message.cursor))
      }
      if (message.cursor !== undefined) {
        await persistBestEffort({ ...currentRealtime, last_cursor: message.cursor })
      }
      return
    }
    if (message.type === "library_changed") {
      handlers?.onEvent(optionalString(optionalString({
        debounce_ms: 2000,
        reason: "library_changed",
      }, "cursor", message.cursor), "path", message.path))
      if (message.cursor !== undefined) {
        await persistBestEffort({ ...currentRealtime, last_cursor: message.cursor, last_event_at: now().toISOString() })
      }
      return
    }
    if (message.type === "resync_required") {
      const reason = message.reason ?? "resync_required"
      handlers?.onEvent(optionalString({ immediate: true, reason }, "cursor", message.cursor))
      if (message.cursor !== undefined || isInvalidCursorReason(reason)) {
        await persistBestEffort(resyncRealtimeState(currentRealtime, message.cursor, reason, now().toISOString()))
      }
      return
    }
    if (message.type === "error") {
      const error = message.message ?? message.code ?? "realtime error"
      if (isRealtimeAuthError(error) || isRealtimeAuthError(message.code)) {
        authFailed = true
        connectionId += 1
        clearReconnectTimer()
        handlers?.onAuthFailed(redactedRealtimeError(error))
        activeSocket?.close()
        activeSocket = undefined
        return
      }
      handlers?.onWarning?.(redactedRealtimeError(error))
      return
    }
    handlers?.onWarning?.("unknown realtime message")
  }

  return {
    async start(nextHandlers) {
      handlers = nextHandlers
      stopped = false
      authFailed = false
      connectNow()
    },
    async close() {
      stopped = true
      clearReconnectTimer()
      activeSocket?.close()
      activeSocket = undefined
    },
  }
}

export function buildDriveRealtimeUrl(baseUrl: string, libraryId: string, realtime: DriveRealtimeState): URL {
  if (realtime.client_id.length === 0) {
    throw new Error("drive realtime client_id is required")
  }
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  url.pathname = `/drive/libraries/${encodeURIComponent(libraryId)}/realtime`
  url.search = ""
  url.hash = ""
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

function resyncRealtimeState(realtime: DriveRealtimeState, cursor: string | undefined, reason: string, lastEventAt: string): DriveRealtimeState {
  if (isInvalidCursorReason(reason)) {
    const { last_cursor: _lastCursor, ...next } = realtime
    return { ...next, last_event_at: lastEventAt }
  }
  return optionalString({ ...realtime, last_event_at: lastEventAt }, "last_cursor", cursor)
}

function isInvalidCursorReason(reason: string): boolean {
  return /\bcursor[_ -]?(invalid|expired|gone|missing|not[_ -]?found)\b|\binvalid[_ -]?cursor\b/i.test(reason)
}

function isRealtimeAuthError(error: unknown): boolean {
  return /\b(401|403|auth|authorization|unauthorized|forbidden)\b/i.test(String(error))
}

function optionalString<T extends object, K extends string>(target: T, key: K, value: unknown): T | (T & Record<K, string>) {
  if (typeof value !== "string") {
    return target
  }
  return { ...target, [key]: value } as T & Record<K, string>
}

function nativeWebSocketConnector(url: URL, handlers: Parameters<DriveRealtimeConnector>[1], init?: DriveRealtimeConnectorInit): { close: () => void } {
  const WebSocketWithInit = WebSocket as unknown as {
    new (url: string | URL, init?: DriveRealtimeConnectorInit): WebSocket
  }
  const ws = new WebSocketWithInit(url.toString(), init)
  let closed = false
  let pendingError: unknown
  const closeOnce = (error?: unknown) => {
    if (closed) return
    closed = true
    handlers.close(error)
  }
  ws.addEventListener("open", () => handlers.open())
  ws.addEventListener("message", (event) => handlers.message(String(event.data)))
  ws.addEventListener("close", (event) => closeOnce(webSocketCloseError(event) ?? pendingError))
  ws.addEventListener("error", (event) => {
    pendingError = webSocketError(event)
    if (isRealtimeAuthError(pendingError)) {
      closeOnce(pendingError)
    }
  })
  return { close: () => ws.close() }
}

function webSocketCloseError(event: CloseEvent): Error | undefined {
  if (event.code === 1000) return undefined
  if (event.code === 4001 || event.code === 4401) return new Error("HTTP 401")
  if (event.code === 4003 || event.code === 4403) return new Error("HTTP 403")
  if (event.reason && isRealtimeAuthError(event.reason)) return new Error(event.reason)
  if (event.reason) return new Error(event.reason)
  return new Error(`WebSocket close ${event.code}`)
}

function webSocketError(event: Event): Error {
  if (typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent) {
    const detail = event.error instanceof Error ? event.error.message : event.message
    if (detail) return new Error(detail)
  }
  return new Error("network error")
}

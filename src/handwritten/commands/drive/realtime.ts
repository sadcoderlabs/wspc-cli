import { driveIsoTimestamp, systemDriveClock, type DriveClock } from "./clock.js"
import type { DriveRealtimeState } from "./state.js"
import type { DriveRealtimeSource } from "./watch.js"

export type DriveRealtimeMessage =
  | { type: "ready"; cursor?: string; replayed: number }
  | { type: "library_changed"; cursor?: string; path?: string; origin_client_id?: string }
  | { type: "resync_required"; cursor?: string; reason?: string }
  | { type: "error"; code?: string; message?: string }
  | { type: "pong" }
  | { type: "unknown"; message_type?: string }

export interface DriveRealtimeConnectorInit {
  headers?: HeadersInit
}

export type DriveRealtimeConnector = (url: URL, handlers: {
  open: () => void
  message: (data: string) => void
  close: (error?: unknown) => void
}, init?: DriveRealtimeConnectorInit) => { close: () => void; send?: (data: string) => void }

// A half-open socket (NAT/edge dropped the connection without a FIN) looks
// exactly like a quiet library: without keepalive the client waits forever and
// misses every remote change. Ping the server and tear the socket down when
// nothing comes back, so the normal reconnect path takes over.
export const REALTIME_PING_INTERVAL_MS = 30_000
export const REALTIME_PONG_TIMEOUT_MS = 10_000

type DriveRealtimeHandlers = Parameters<DriveRealtimeSource["start"]>[0]

export function createDriveRealtimeSource(args: {
  baseUrl: string
  libraryId: string
  realtime: DriveRealtimeState
  writeRealtimeState: (next: DriveRealtimeState) => Promise<void>
  connect?: DriveRealtimeConnector
  headers?: HeadersInit | (() => Promise<HeadersInit>)
  clock?: DriveClock
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}): DriveRealtimeSource {
  const connect = args.connect ?? nativeWebSocketConnector
  const clock = args.clock ?? systemDriveClock
  const scheduleTimeout = args.setTimeout ?? setTimeout
  const cancelTimeout = args.clearTimeout ?? clearTimeout
  let currentRealtime = { ...args.realtime }
  let handlers: DriveRealtimeHandlers | undefined
  let activeSocket: { close: () => void; send?: (data: string) => void } | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectDelayMs = 1000
  let stopped = false
  let authFailed = false
  let connectionId = 0
  let pingTimer: ReturnType<typeof setTimeout> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let pendingRealtime: DriveRealtimeState | undefined
  let persistTask: Promise<void> | undefined

  function clearReconnectTimer(): void {
    if (reconnectTimer === undefined) return
    cancelTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  function clearKeepaliveTimers(): void {
    if (pingTimer !== undefined) {
      cancelTimeout(pingTimer)
      pingTimer = undefined
    }
    if (pongTimer !== undefined) {
      cancelTimeout(pongTimer)
      pongTimer = undefined
    }
  }

  function schedulePing(id: number): void {
    const send = activeSocket?.send
    if (send === undefined) return
    pingTimer = scheduleTimeout(() => {
      pingTimer = undefined
      if (id !== connectionId || stopped || authFailed) return
      try {
        send(JSON.stringify({ type: "ping" }))
      } catch (error) {
        closeConnection(id, error)
        return
      }
      pongTimer = scheduleTimeout(() => {
        pongTimer = undefined
        closeConnection(
          id,
          Object.assign(new Error("no traffic within realtime keepalive timeout"), {
            code: "PING_TIMEOUT",
          }),
        )
      }, REALTIME_PONG_TIMEOUT_MS)
    }, REALTIME_PING_INTERVAL_MS)
  }

  function markAlive(id: number): void {
    if (id !== connectionId) return
    if (pongTimer !== undefined) {
      cancelTimeout(pongTimer)
      pongTimer = undefined
    }
    if (pingTimer === undefined) schedulePing(id)
  }

  async function flushRealtimeState(): Promise<void> {
    while (pendingRealtime !== undefined && !stopped) {
      const next = pendingRealtime
      pendingRealtime = undefined
      try {
        await args.writeRealtimeState(next)
      } catch (error) {
        const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
        if (code === "WSPC_DRIVE_LOCK_HELD") {
          pendingRealtime = currentRealtime
        } else {
          handlers?.onWarning?.(redactedRealtimeError(error))
        }
      }
    }
  }

  function persistBestEffort(next: DriveRealtimeState): void {
    currentRealtime = next
    pendingRealtime = next
    if (persistTask !== undefined) return
    persistTask = flushRealtimeState().finally(() => {
      persistTask = undefined
    })
  }

  function connectNow(): void {
    if (stopped || authFailed) return
    clearReconnectTimer()
    const id = ++connectionId
    const headers = args.headers
    if (typeof headers !== "function") {
      openSocket(id, headers)
      return
    }
    // Header providers re-resolve auth per attempt: a token snapshot taken at
    // watch start goes stale, and an expired-token handshake rejection is
    // indistinguishable from a network error, so reconnects would loop forever.
    void headers()
      .then((resolved) => openSocket(id, resolved))
      .catch((error) => closeConnection(id, error))
  }

  function openSocket(id: number, headers: HeadersInit | undefined): void {
    if (id !== connectionId || stopped || authFailed) return
    const url = buildDriveRealtimeUrl(args.baseUrl, args.libraryId, currentRealtime)
    activeSocket = connect(url, {
      open() {
        if (id !== connectionId || stopped || authFailed) return
        reconnectDelayMs = 1000
        schedulePing(id)
        persistBestEffort({ ...currentRealtime, last_connected_at: driveIsoTimestamp(clock) })
        handlers?.onConnected()
      },
      message(data) {
        if (id !== connectionId || stopped || authFailed) return
        markAlive(id)
        void handleMessage(id, data).catch((error) => handlers?.onWarning?.(redactedRealtimeError(error)))
      },
      close(error) {
        closeConnection(id, error ?? "close")
      },
    }, headers === undefined ? undefined : { headers })
  }

  function closeConnection(id: number, error: unknown): void {
    if (id !== connectionId || stopped || authFailed) return
    connectionId += 1
    const socket = activeSocket
    activeSocket = undefined
    clearReconnectTimer()
    clearKeepaliveTimers()
    socket?.close()
    // A socket rejected on auth grounds is not terminal: the header provider
    // re-resolves credentials per attempt, so reconnecting is what lets an
    // expired access token rotate. Giving up would leave the watch with no
    // source of remote changes at all. See ADR-0001 in wspc-drive.
    if (isTerminalAuthError(error)) {
      authFailed = true
      handlers?.onAuthFailed(redactedRealtimeError(error), refreshRejectionReason(error))
      return
    }
    const delayMs = reconnectDelayMs
    handlers?.onReconnect(delayMs, redactedRealtimeError(error), isRealtimeAuthError(error) ? "auth" : "network")
    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = undefined
      connectNow()
    }, delayMs)
    reconnectDelayMs = Math.min(delayMs * 2, 60_000)
  }

  async function handleMessage(id: number, data: string): Promise<void> {
    const message = parseDriveRealtimeMessage(data)
    if (message.type === "ready") {
      if (message.replayed > 0) {
        handlers?.onEvent({
          debounce_ms: 2000,
          reason: "ready_replay",
          ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
        })
      }
      if (message.cursor !== undefined) {
        persistBestEffort({ ...currentRealtime, last_cursor: message.cursor })
      }
      return
    }
    if (message.type === "library_changed") {
      // Own echo: this client caused the change, so a sync would be a no-op;
      // only the cursor needs to advance.
      const ownEcho = message.origin_client_id !== undefined && message.origin_client_id === currentRealtime.client_id
      if (!ownEcho) {
        handlers?.onEvent({
          debounce_ms: 2000,
          reason: "library_changed",
          ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
          ...(message.path === undefined ? {} : { path: message.path }),
        })
      }
      if (message.cursor !== undefined) {
        persistBestEffort({ ...currentRealtime, last_cursor: message.cursor, last_event_at: driveIsoTimestamp(clock) })
      }
      return
    }
    if (message.type === "resync_required") {
      const reason = message.reason ?? "resync_required"
      handlers?.onEvent({
        immediate: true,
        reason,
        ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
      })
      if (message.cursor !== undefined || isInvalidCursorReason(reason)) {
        persistBestEffort(resyncRealtimeState(currentRealtime, message.cursor, reason, driveIsoTimestamp(clock)))
      }
      return
    }
    if (message.type === "pong") {
      return
    }
    if (message.type === "error") {
      const error = message.message ?? message.code ?? "realtime error"
      // An auth frame from the server says this socket's credentials were
      // rejected, never that the refresh token itself is dead. Drop the
      // connection and let the reconnect path re-resolve credentials.
      if (isRealtimeAuthError(error) || isRealtimeAuthError(message.code)) {
        closeConnection(id, error)
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
      pendingRealtime = undefined
      clearReconnectTimer()
      clearKeepaliveTimers()
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
    return {
      type: "ready",
      replayed: typeof value.replayed === "number" ? value.replayed : 0,
      ...(cursor === undefined ? {} : { cursor }),
    }
  }
  if (messageType === "library_changed") {
    return {
      type: "library_changed",
      ...(cursor === undefined ? {} : { cursor }),
      ...(typeof value.path === "string" ? { path: value.path } : {}),
      ...(typeof value.origin_client_id === "string" ? { origin_client_id: value.origin_client_id } : {}),
    }
  }
  if (messageType === "resync_required") {
    return {
      type: "resync_required",
      ...(cursor === undefined ? {} : { cursor }),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    }
  }
  if (messageType === "error") {
    return {
      type: "error",
      ...(typeof value.code === "string" ? { code: value.code } : {}),
      ...(typeof value.message === "string" ? { message: redactedRealtimeError(value.message) } : {}),
    }
  }
  if (messageType === "pong") {
    return { type: "pong" }
  }
  return {
    type: "unknown",
    ...(messageType === undefined ? {} : { message_type: messageType }),
  }
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
    return withRealtimeCode("network error", error)
  }
  return withRealtimeCode("realtime error", error)
}

// Append a safe diagnostic token — a Node system error code (ECONNRESET,
// ETIMEDOUT, ...) or a numeric WebSocket close code — so a bare "realtime
// error" carries something actionable. Never includes the message payload or
// URL, keeping the redaction boundary intact.
function withRealtimeCode(label: string, error: unknown): string {
  if (typeof error !== "object" || error === null) return label
  const code = (error as { code?: unknown }).code
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
    return `${label} (${code})`
  }
  if (typeof code === "number" && Number.isInteger(code)) {
    return `${label} (${code})`
  }
  return label
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function resyncRealtimeState(realtime: DriveRealtimeState, cursor: string | undefined, reason: string, lastEventAt: string): DriveRealtimeState {
  if (isInvalidCursorReason(reason)) {
    const { last_cursor: _lastCursor, ...next } = realtime
    return { ...next, last_event_at: lastEventAt }
  }
  return {
    ...realtime,
    last_event_at: lastEventAt,
    ...(cursor === undefined ? {} : { last_cursor: cursor }),
  }
}

function isInvalidCursorReason(reason: string): boolean {
  return /\bcursor[_ -]?(invalid|expired|gone|missing|not[_ -]?found)\b|\binvalid[_ -]?cursor\b/i.test(reason)
}

// The server refused to rotate the refresh token, so no amount of reconnecting
// will help and only a human running `wspc login` can recover.
function isTerminalAuthError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "WSPC_AUTH_EXPIRED"
}

// `redactedRealtimeError` flattens every auth message to "auth failed", so the
// machine reason has to be read off the error itself to survive into the log.
function refreshRejectionReason(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const reason = (error as { reason?: unknown }).reason
  return typeof reason === "string" && reason.length > 0 ? reason : undefined
}

// Recognises an auth-shaped failure so we can drop the socket and label the
// reconnect. Deliberately loose, which is safe now that it never decides
// whether to give up: only isTerminalAuthError does that.
function isRealtimeAuthError(error: unknown): boolean {
  if (isTerminalAuthError(error)) return true
  return /\b(401|403|auth|authorization|unauthorized|forbidden)\b/i.test(String(error))
}

function nativeWebSocketConnector(url: URL, handlers: Parameters<DriveRealtimeConnector>[1], init?: DriveRealtimeConnectorInit): { close: () => void; send: (data: string) => void } {
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
  return { close: () => ws.close(), send: (data: string) => ws.send(data) }
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

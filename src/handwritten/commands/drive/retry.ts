import { DateTime } from "luxon"

export class DriveHttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly retryAfterMs?: number

  constructor(status: number, options: { code?: string; retryAfterMs?: number } = {}) {
    super(`HTTP ${status}`)
    this.name = "DriveHttpError"
    this.status = status
    this.code = options.code
    this.retryAfterMs = options.retryAfterMs
  }
}

export interface DriveRetryDecision {
  reason: "rate_limited" | "transient"
  delayMs: number
}

export interface DrivePathErrorSummary {
  path: string
  code: string
  message: string
  retryable: boolean
}

export class DriveRetryableSyncError extends Error {
  readonly cause: unknown
  readonly remaining?: number
  readonly pathErrors: DrivePathErrorSummary[]

  constructor(cause: unknown, context: { remaining?: number; pathErrors?: DrivePathErrorSummary[] } = {}) {
    super(errorMessage(cause))
    this.name = "DriveRetryableSyncError"
    this.cause = cause
    this.remaining = context.remaining
    this.pathErrors = context.pathErrors ?? []
  }
}

export function driveHttpError(response: Response, payload?: unknown, now: DateTime = DateTime.utc()): DriveHttpError {
  const code = errorCode(payload)
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after") ?? undefined, now)
  return new DriveHttpError(response.status, {
    ...(code === undefined ? {} : { code }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

export function parseRetryAfter(value: string | undefined, now: DateTime): number | undefined {
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    const milliseconds = seconds * 1000
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined
  }
  const retryAt = DateTime.fromHTTP(value, { setZone: true })
  if (!retryAt.isValid || !now.isValid) return undefined
  return Math.max(0, retryAt.toMillis() - now.toMillis())
}

export function classifyDriveRetry(error: unknown, fallbackMs: number, _now: DateTime): DriveRetryDecision | undefined {
  const failure = error instanceof DriveRetryableSyncError ? error.cause : error
  const fallbackDelayMs = Math.min(Math.max(0, fallbackMs), 60_000)
  if (failure instanceof DriveHttpError && failure.status === 429) {
    return {
      reason: "rate_limited",
      delayMs: failure.retryAfterMs ?? fallbackDelayMs,
    }
  }
  if (failure instanceof DriveHttpError && failure.status >= 500) {
    return {
      reason: "transient",
      delayMs: failure.retryAfterMs ?? fallbackDelayMs,
    }
  }
  if (failure instanceof TypeError && /\b(fetch|network)\b/i.test(failure.message)) {
    return { reason: "transient", delayMs: fallbackDelayMs }
  }
  if (hasNetworkErrorCode(failure)) {
    return { reason: "transient", delayMs: fallbackDelayMs }
  }
  const status = structuredStatus(failure)
  const message = errorMessage(failure)
  if (status === 401 || status === 403 || /\b(auth|authorization)\b/i.test(message)) return undefined
  if (status === 429 || /\b429\b/.test(message)) {
    return { reason: "rate_limited", delayMs: fallbackDelayMs }
  }
  if ((status !== undefined && status >= 500) || /\b(5\d\d|network|temporary|fetch)\b/i.test(message)) {
    return { reason: "transient", delayMs: fallbackDelayMs }
  }
  return undefined
}

export function isRetryableDriveFailure(error: unknown): boolean {
  return classifyDriveRetry(error, 0, DateTime.utc()) !== undefined
}

export function isDriveAuthFailure(error: unknown): boolean {
  const failure = error instanceof DriveRetryableSyncError ? error.cause : error
  const status = failure instanceof DriveHttpError ? failure.status : structuredStatus(failure)
  if (status === 401 || status === 403) return true
  if (typeof failure !== "object" || failure === null) return false
  const code = (failure as { code?: unknown }).code
  return code === "WSPC_AUTH_EXPIRED" || code === "UNAUTHORIZED" || code === "FORBIDDEN"
}

function errorCode(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const direct = (payload as { code?: unknown }).code
  if (isSafeErrorCode(direct)) return direct
  const nested = (payload as { error?: unknown }).error
  if (typeof nested !== "object" || nested === null) return undefined
  const code = (nested as { code?: unknown }).code
  return isSafeErrorCode(code) ? code : undefined
}

function isSafeErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
}

function structuredStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
])

function hasNetworkErrorCode(error: unknown): boolean {
  const seen = new Set<object>()
  let current = error
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: unknown }).code
    if (typeof code === "string" && (NETWORK_ERROR_CODES.has(code) || code.startsWith("UND_ERR_"))) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

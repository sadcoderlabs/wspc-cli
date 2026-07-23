import { describe, expect, it } from "vitest"
import { DateTime } from "luxon"
import { DriveHttpError, classifyDriveRetry, parseRetryAfter } from "../../../src/handwritten/commands/drive/retry.js"

describe("Drive retry policy", () => {
  it("parses Retry-After delta seconds", () => {
    const now = DateTime.fromISO("2026-07-23T00:00:00Z", { setZone: true })

    expect(parseRetryAfter("60", now)).toBe(60_000)
  })

  it("parses Retry-After HTTP dates relative to the supplied clock", () => {
    const now = DateTime.fromISO("2026-07-23T00:00:00Z", { setZone: true })

    expect(parseRetryAfter("Thu, 23 Jul 2026 00:02:00 GMT", now)).toBe(120_000)
    expect(parseRetryAfter("Wed, 22 Jul 2026 23:59:00 GMT", now)).toBe(0)
  })

  it("ignores malformed and negative Retry-After values", () => {
    const now = DateTime.fromISO("2026-07-23T00:00:00Z", { setZone: true })

    expect(parseRetryAfter("later", now)).toBeUndefined()
    expect(parseRetryAfter("-1", now)).toBeUndefined()
  })

  it("honors an explicit rate-limit delay without applying the fallback cap", () => {
    const error = new DriveHttpError(429, { code: "RATE_LIMITED", retryAfterMs: 120_000 })

    expect(classifyDriveRetry(error, 60_000)).toEqual({ reason: "rate_limited", delayMs: 120_000 })
    expect(error.message).toBe("HTTP 429")
  })

  it("caps fallback delays for transient failures and rejects permanent HTTP failures", () => {
    expect(classifyDriveRetry(new DriveHttpError(503), 120_000)).toEqual({
      reason: "transient",
      delayMs: 60_000,
    })
    expect(classifyDriveRetry(new TypeError("fetch failed"), 2_000)).toEqual({
      reason: "transient",
      delayMs: 2_000,
    })
    expect(classifyDriveRetry(new DriveHttpError(401), 1_000)).toBeUndefined()
  })

  it("classifies standard Node network error codes as transient", () => {
    const reset = Object.assign(new Error("socket closed"), { code: "ECONNRESET" })

    expect(classifyDriveRetry(reset, 1_000)).toEqual({ reason: "transient", delayMs: 1_000 })
  })
})

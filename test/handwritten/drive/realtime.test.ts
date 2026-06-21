import { describe, expect, it } from "vitest"
import {
  buildDriveRealtimeUrl,
  parseDriveRealtimeMessage,
  redactedRealtimeError,
} from "../../../src/handwritten/commands/drive/realtime.js"

describe("drive realtime helpers", () => {
  it("builds websocket urls from api urls without token data", () => {
    expect(buildDriveRealtimeUrl("https://api.wspc.ai", "lib_1", { client_id: "drvcli_abc" }).toString()).toBe(
      "wss://api.wspc.ai/drive/libraries/lib_1/realtime?client_id=drvcli_abc",
    )
    expect(buildDriveRealtimeUrl("http://127.0.0.1:8787", "lib/a", {
      client_id: "drvcli_abc",
      last_cursor: "cur_1",
    }).toString()).toBe(
      "ws://127.0.0.1:8787/drive/libraries/lib%2Fa/realtime?cursor=cur_1&client_id=drvcli_abc",
    )

    const url = buildDriveRealtimeUrl("https://api.wspc.ai?token=secret-token#token=secret-fragment", "lib_1", {
      client_id: "drvcli_abc",
    })
    expect(url.searchParams.get("client_id")).toBe("drvcli_abc")
    expect(url.searchParams.has("cursor")).toBe(false)
    expect(url.searchParams.has("token")).toBe(false)
    expect(url.hash).toBe("")
  })

  it("requires a realtime client id", () => {
    expect(() => buildDriveRealtimeUrl("https://api.wspc.ai", "lib_1", { client_id: "" })).toThrow(/client_id is required/)
  })

  it("parses known realtime messages", () => {
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "ready", cursor: "c2", replayed: 1 }))).toEqual({
      type: "ready",
      cursor: "c2",
      replayed: 1,
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "library_changed", cursor: "c3", path: "notes.md" }))).toEqual({
      type: "library_changed",
      cursor: "c3",
      path: "notes.md",
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({ type: "resync_required", cursor: "c4", reason: "cursor_invalid" }))).toEqual({
      type: "resync_required",
      cursor: "c4",
      reason: "cursor_invalid",
    })
    expect(parseDriveRealtimeMessage(JSON.stringify({
      type: "error",
      code: "forbidden",
      message: "HTTP 403: Bearer secret-token",
    }))).toEqual({
      type: "error",
      code: "forbidden",
      message: "HTTP 403",
    })
  })

  it("returns unknown for invalid json and strips sensitive unknown fields", () => {
    expect(parseDriveRealtimeMessage("{")).toEqual({ type: "unknown" })
    expect(parseDriveRealtimeMessage(JSON.stringify({
      type: "mystery",
      token: "secret-token",
      refresh_token: "secret-refresh-token",
    }))).toEqual({
      type: "unknown",
      message_type: "mystery",
    })
  })

  it("redacts realtime errors", () => {
    expect(redactedRealtimeError(new Error("HTTP 403: Bearer secret-token"))).toBe("HTTP 403")
    expect(redactedRealtimeError(new Error("WebSocket network close: secret-token"))).toBe("network error")
  })
})

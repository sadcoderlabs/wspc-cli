import { describe, it, expect, vi } from "vitest"
import { fetchMe } from "../src/handwritten/auth/fetch-me.js"

describe("fetchMe", () => {
  it("sends Bearer token and returns user_id + email", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.wspc.ai/auth/me")
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_x")
      return new Response(JSON.stringify({ user_id: "usr_1", email: "a@x.com" }), { status: 200 })
    }) as unknown as typeof fetch

    const me = await fetchMe({ baseUrl: "https://api.wspc.ai", token: "tok_x", fetchImpl })
    expect(me).toEqual({ user_id: "usr_1", email: "a@x.com" })
  })

  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch
    await expect(fetchMe({ baseUrl: "https://api.wspc.ai", token: "bad", fetchImpl })).rejects.toThrow(
      /auth_me_failed/,
    )
  })

  it("throws when body is missing email", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ user_id: "usr_1" }), { status: 200 }),
    ) as unknown as typeof fetch
    await expect(fetchMe({ baseUrl: "https://api.wspc.ai", token: "t", fetchImpl })).rejects.toThrow(
      /auth_me_failed/,
    )
  })
})

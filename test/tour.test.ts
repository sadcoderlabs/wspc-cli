import { describe, it, expect, vi } from "vitest"
import { fetchGuide, resolveGuideUrl, GUIDE_URL_DEFAULT } from "../src/handwritten/commands/tour.js"

describe("resolveGuideUrl", () => {
  it("defaults to the public mcp guide endpoint", () => {
    expect(resolveGuideUrl({})).toBe(GUIDE_URL_DEFAULT)
  })
  it("honors WSPC_GUIDE_URL override", () => {
    expect(resolveGuideUrl({ WSPC_GUIDE_URL: "http://127.0.0.1:8787/guide" })).toBe(
      "http://127.0.0.1:8787/guide",
    )
  })
})

describe("fetchGuide", () => {
  it("returns the body text on 200", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("TOUR SCRIPT", { status: 200 }),
    ) as unknown as typeof fetch
    const text = await fetchGuide("https://mcp.wspc.ai/guide", fetchImpl)
    expect(text).toBe("TOUR SCRIPT")
  })
  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
    await expect(fetchGuide("https://mcp.wspc.ai/guide", fetchImpl)).rejects.toThrow(/tour_fetch_failed/)
  })
})

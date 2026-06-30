import { describe, expect, it, vi } from "vitest"
import { render } from "./render.js"

function capture(fn: () => void): string {
  let out = ""
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
    out += s
    return true
  })
  fn()
  spy.mockRestore()
  return out
}

describe("renderList deleted rows", () => {
  it("marks soft-deleted rows with a ✕ prefix", () => {
    // Force pretty output regardless of TTY detection in test environment.
    process.env.WSPC_OUTPUT = "pretty"
    try {
      const ctx = { display: { shape: "list", columns: ["id", "title"] } } as any
      const out = capture(() =>
        render(ctx, {
          items: [
            { id: "a", title: "active", deleted_at: null },
            { id: "b", title: "gone", deleted_at: 1748822400000 },
          ],
        }),
      )
      expect(out).toContain("✕")
      // active row must not carry the marker
      const activeLine = out.split("\n").find((l) => l.includes("active")) ?? ""
      expect(activeLine).not.toContain("✕")
    } finally {
      delete process.env.WSPC_OUTPUT
    }
  })
})

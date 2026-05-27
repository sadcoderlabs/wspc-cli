import { describe, expect, it } from "vitest"
import { boolBadge } from "../../src/handwritten/output/primitives.js"

describe("boolBadge", () => {
  it("renders true as a 'read' marker", () => {
    expect(boolBadge(true)).toContain("read")
    expect(boolBadge(true)).not.toContain("unread")
  })

  it("renders false as 'unread'", () => {
    expect(boolBadge(false)).toContain("unread")
  })

  it("falls back to String() for non-boolean values", () => {
    expect(boolBadge("maybe")).toBe("maybe")
    expect(boolBadge(null)).toBe("null")
  })
})

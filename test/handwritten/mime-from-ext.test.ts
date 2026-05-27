import { describe, expect, it } from "vitest"
import { mimeFromExt } from "../../src/handwritten/utils/mime-from-ext.js"

describe("mimeFromExt", () => {
  it("maps common extensions to MIME types", () => {
    expect(mimeFromExt("report.pdf")).toBe("application/pdf")
    expect(mimeFromExt("photo.PNG")).toBe("image/png")
    expect(mimeFromExt("photo.jpg")).toBe("image/jpeg")
    expect(mimeFromExt("photo.jpeg")).toBe("image/jpeg")
    expect(mimeFromExt("data.csv")).toBe("text/csv")
    expect(mimeFromExt("page.html")).toBe("text/html")
  })

  it("falls back to application/octet-stream for unknown extensions", () => {
    expect(mimeFromExt("weird.xyz")).toBe("application/octet-stream")
    expect(mimeFromExt("noext")).toBe("application/octet-stream")
  })
})

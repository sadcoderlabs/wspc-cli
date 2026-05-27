import { describe, expect, it } from "vitest"
import { parseContentDispositionFilename } from "../../src/handwritten/utils/parse-content-disposition.js"

describe("parseContentDispositionFilename", () => {
  it("extracts quoted filename", () => {
    expect(parseContentDispositionFilename(`attachment; filename="invoice.pdf"`))
      .toBe("invoice.pdf")
  })

  it("extracts unquoted filename", () => {
    expect(parseContentDispositionFilename(`attachment; filename=report.pdf`))
      .toBe("report.pdf")
  })

  it("returns undefined for missing header", () => {
    expect(parseContentDispositionFilename(null)).toBeUndefined()
    expect(parseContentDispositionFilename(undefined)).toBeUndefined()
  })

  it("returns undefined for non-attachment disposition", () => {
    expect(parseContentDispositionFilename(`inline`)).toBeUndefined()
  })

  it("ignores RFC 5987 filename* (v1 not supported)", () => {
    const out = parseContentDispositionFilename(
      `attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
    )
    expect(out).toBeUndefined()
  })
})

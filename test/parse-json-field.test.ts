import { InvalidArgumentError } from "commander"
import { describe, expect, it, vi } from "vitest"
import { parseJsonField } from "../src/handwritten/utils/parse-json-field.js"

describe("parseJsonField", () => {
  it("returns undefined for omitted input", () => {
    expect(parseJsonField(undefined, "custom-fields")).toBeUndefined()
  })

  it("parses object and array values", () => {
    expect(parseJsonField('{"priority":"high"}', "custom-fields")).toEqual({
      priority: "high",
    })
    expect(parseJsonField('["one","two"]', "tags")).toEqual(["one", "two"])
  })

  it("throws an option-specific error for malformed JSON without process side effects", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("forced process exit")
    })
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      expect(() => parseJsonField("{", "custom-fields")).toThrow(InvalidArgumentError)
      expect(() => parseJsonField("{", "custom-fields")).toThrow(
        "Invalid JSON for --custom-fields: {",
      )
      expect(exit).not.toHaveBeenCalled()
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      exit.mockRestore()
      stderr.mockRestore()
    }
  })
})

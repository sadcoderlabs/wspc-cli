import { InvalidArgumentError } from "commander"
import { describe, expect, it } from "vitest"
import {
  parseBooleanField,
  parseIntegerField,
  parseNumberField,
} from "./parse-scalar-field.js"

describe("parse scalar CLI fields", () => {
  it("parses finite numbers", () => {
    expect(parseNumberField("1.5", "ratio")).toBe(1.5)
    expect(parseNumberField("-2e3", "ratio")).toBe(-2000)
  })

  it.each(["", "NaN", "Infinity", "12px"])(
    "rejects invalid number %j",
    (raw) => {
      expect(() => parseNumberField(raw, "ratio")).toThrow(InvalidArgumentError)
    },
  )

  it("parses integers and rejects fractional numbers", () => {
    expect(parseIntegerField("42", "expected-version")).toBe(42)
    expect(() => parseIntegerField("1.5", "expected-version")).toThrow(
      InvalidArgumentError,
    )
  })

  it("parses explicit boolean values", () => {
    expect(parseBooleanField("true", "cascade")).toBe(true)
    expect(parseBooleanField("false", "cascade")).toBe(false)
    expect(() => parseBooleanField("yes", "cascade")).toThrow(
      InvalidArgumentError,
    )
  })
})

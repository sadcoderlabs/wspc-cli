import { describe, expect, it } from "vitest"
import { resolve } from "node:path"
import {
  resolveInsideRoot,
  validateDrivePath,
} from "../../../src/handwritten/commands/drive/path-policy.js"

describe("drive path policy", () => {
  it("accepts safe normalized relative paths", () => {
    expect(validateDrivePath("notes/today.md")).toBe("notes/today.md")
  })

  it("rejects unsafe drive paths", () => {
    expect(() => validateDrivePath("/x")).toThrow()
    expect(() => validateDrivePath("../x")).toThrow()
    expect(() => validateDrivePath("a//b")).toThrow()
    expect(() => validateDrivePath("a\\b")).toThrow()
    expect(() => validateDrivePath("C:/x")).toThrow()
    expect(() => validateDrivePath("C:foo")).toThrow()
    expect(() => validateDrivePath("C:")).toThrow()
    expect(() => validateDrivePath("C:\\x")).toThrow()
    expect(() => validateDrivePath("\\\\server\\share")).toThrow()
    expect(() => validateDrivePath("a\u0000b")).toThrow()
  })

  it("rejects empty and dot path segments", () => {
    expect(() => validateDrivePath("")).toThrow()
    expect(() => validateDrivePath(".")).toThrow()
    expect(() => validateDrivePath("./x")).toThrow()
    expect(() => validateDrivePath("x/.")).toThrow()
    expect(() => validateDrivePath("x/..")).toThrow()
  })

  it("rejects segment and total path byte limits", () => {
    expect(() => validateDrivePath("a/" + "b".repeat(256))).toThrow()

    const longSegment = "x".repeat(10)
    const longPath = Array.from({ length: 100 }, () => longSegment).join("/")
    expect(Buffer.byteLength(longPath, "utf8")).toBeGreaterThan(1024)
    expect(() => validateDrivePath(longPath)).toThrow()
  })

  it("resolves valid drive path inside root", () => {
    const root = resolve("/tmp/drive-root")
    const path = resolveInsideRoot(root, "docs/readme.md")
    expect(path).toBe(resolve(root, "docs/readme.md"))
  })

  it("rejects drive paths that escape root", () => {
    const root = resolve("/tmp/drive-root")
    expect(() => resolveInsideRoot(root, "../escape.txt")).toThrow()
  })
})

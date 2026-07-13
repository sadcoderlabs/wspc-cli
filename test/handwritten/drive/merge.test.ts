import { describe, expect, it } from "vitest"
import { classifyMergeText, conflictCopyPath, mergeText3 } from "../../../src/handwritten/commands/drive/merge.js"

describe("drive merge helpers", () => {
  it("classifies small utf8 text extensions as mergeable", () => {
    expect(classifyMergeText("notes/today.md", Buffer.from("hello\n"), undefined).mergeable).toBe(true)
  })

  it("rejects binary nul bytes, invalid utf8, and files over 1 MiB", () => {
    expect(classifyMergeText("notes/today.md", Buffer.from([0, 1, 2]), undefined).mergeable).toBe(false)
    expect(classifyMergeText("notes/today.md", Buffer.from([0xff]), undefined).mergeable).toBe(false)
    expect(classifyMergeText("notes/today.md", Buffer.alloc(1024 * 1024 + 1, "a"), undefined).mergeable).toBe(false)
  })

  it("allows text mime hints when extension is unknown and sniff passes", () => {
    expect(classifyMergeText("README", Buffer.from("hello\n"), "text/plain").mergeable).toBe(true)
  })

  it("keeps local newline style for clean merges", () => {
    const result = mergeText3("a\nb\nc\n", "a\r\nlocal\r\nb\r\nc\r\n", "a\nb\nremote\nc\n")

    expect(result).toEqual({ clean: true, text: "a\r\nlocal\r\nb\r\nremote\r\nc\r\n" })
  })

  it("reports same-offset different insertions as conflicts", () => {
    const result = mergeText3("a\nb\n", "a\nlocal\nb\n", "a\nremote\nb\n")

    expect(result.clean).toBe(false)
    expect("text" in result).toBe(false)
  })

  it("reports hunk conflicts without conflict markers", () => {
    const result = mergeText3("a\nold\n", "a\nlocal\n", "a\nremote\n")

    expect(result.clean).toBe(false)
    expect("text" in result).toBe(false)
  })

  it("builds conflict copy paths next to the original path with the full version id", () => {
    expect(conflictCopyPath("notes/today.md", "remote", "20260621T101000Z", "ver_remote")).toBe(
      "notes/today.remote-conflict-20260621T101000Z-ver_remote.md",
    )
    expect(
      conflictCopyPath("large-doc-1.md", "remote", "20260713T044616Z", "fvr_01KXCWQTX8K7NMK8VW3EKR2166"),
    ).toBe("large-doc-1.remote-conflict-20260713T044616Z-fvr_01KXCWQTX8K7NMK8VW3EKR2166.md")
  })
})

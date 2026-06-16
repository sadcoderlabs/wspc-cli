import { vi } from "vitest"

export function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk))
    return true
  })
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  }
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

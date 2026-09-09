import { Command } from "commander"
import { beforeEach, expect, it, vi } from "vitest"
import { mountDriveCommands } from "../../src/cli.js"
import { driveFileDelete } from "../../src/generated/sdk/index.js"

vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({ loadSdkClient: vi.fn(async () => ({ _rawClient: {} })) }))
vi.mock("../../src/generated/sdk/index.js", async importOriginal => ({ ...await importOriginal<typeof import("../../src/generated/sdk/index.js")>(), driveFileDelete: vi.fn(async () => ({ response: { ok: false, status: 409 }, error: { code: "VERSION_CONFLICT" } })) }))

beforeEach(() => { vi.clearAllMocks(); process.exitCode = undefined })
function command() {
  const root = new Command()
  root.command("drive").command("file").command("rm").argument("<id>").argument("<path>").option("--expected-entry-version <value>")
  mountDriveCommands(root)
  const rm = root.commands[0]!.commands.find(c => c.name() === "file")!.commands.find(c => c.name() === "rm")!
  return rm.exitOverride().configureOutput({ writeErr: () => undefined })
}
it("sends the explicit rm confirmation once on conflict", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  await command().parseAsync(["node", "rm", "lib_1", "a.txt", "--entry-id", "original-id", "--expected-entry-version", "2"])
  expect(driveFileDelete).toHaveBeenCalledTimes(1)
  expect(vi.mocked(driveFileDelete).mock.calls[0]?.[0]?.body).toEqual({ entry_id: "original-id", path: "a.txt", expected_entry_version: 2 })
  expect(process.exitCode).toBe(1)
  process.exitCode = undefined
  stderr.mockRestore()
})
it.each([[], ["--entry-id", "original-id"], ["--expected-entry-version", "2"], ["--entry-id", "", "--expected-entry-version", "2"], ...["0", "-1", "1.5", "9007199254740992", "null", "abc"].map(v => ["--entry-id", "original-id", "--expected-entry-version", v])])("rejects invalid rm confirmation %j without a request", async (...flags) => {
  await expect(command().parseAsync(["node", "rm", "lib_1", "a.txt", ...flags])).rejects.toThrow()
  expect(driveFileDelete).toHaveBeenCalledTimes(0)
})

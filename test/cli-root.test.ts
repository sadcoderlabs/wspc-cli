import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

describe("CLI root", () => {
  beforeAll(() => {
    if (!existsSync("dist/cli.js")) {
      const r = spawnSync("npm", ["run", "build"], { encoding: "utf8", shell: true })
      if (r.status !== 0) throw new Error(`build failed: ${r.stderr}`)
    }
  })

  it("`wspc --version` prints version + spec sha", () => {
    const res = spawnSync("node", ["./dist/cli.js", "--version"], { encoding: "utf8" })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/wspc \d+\.\d+\.\d+ \(spec [a-z0-9]+/)
  })

  it("`wspc --help` lists todo and login subcommands", () => {
    const res = spawnSync("node", ["./dist/cli.js", "--help"], { encoding: "utf8" })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("todo")
    expect(res.stdout).toContain("login")
    expect(res.stdout).toContain("logout")
    expect(res.stdout).toContain("whoami")
    expect(res.stdout).toContain("config")
  })
})

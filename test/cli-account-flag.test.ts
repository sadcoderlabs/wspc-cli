import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Uses the spawnSync / dist pattern from cli-root.test.ts:
// import { dispatch } would trigger the top-level dispatch(process.argv) on
// module load, so we test against the built binary instead.

// A temp HOME with no .wspc/config.json gives an isolated empty-config env.
const tempHome = mkdtempSync(join(tmpdir(), "wspc-cli-flag-"))
const isolatedEnv = { ...process.env, HOME: tempHome, USERPROFILE: tempHome }

describe("global --account flag", () => {
  beforeAll(() => {
    if (!existsSync("dist/cli.js")) {
      const r = spawnSync("npm", ["run", "build"], { encoding: "utf8", shell: true })
      if (r.status !== 0) throw new Error(`build failed: ${r.stderr}`)
    }
  })

  it("`wspc --help` lists the `account` command", () => {
    const res = spawnSync("node", ["./dist/cli.js", "--help"], { encoding: "utf8" })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("account")
  })

  it("`wspc account ls` on empty config produces account-list output", () => {
    // Run with an isolated HOME so ConfigStore finds no config file and returns
    // an empty account list. Output must mention "accounts" (JSON) or
    // "no accounts" (pretty) — match case-insensitively for both TTY/non-TTY.
    const res = spawnSync("node", ["./dist/cli.js", "account", "ls"], {
      encoding: "utf8",
      env: isolatedEnv,
    })
    // Exit 0: an empty account list is not an error
    expect(res.status).toBe(0)
    // Match JSON {"accounts":[]} or pretty "no accounts" / "EMAIL" header
    const combined = res.stdout + res.stderr
    expect(combined).toMatch(/accounts/i)
  })

  it("`wspc --account x@y.com whoami` accepts the flag (not flagged as unknown option)", () => {
    // We cannot directly inspect process.env of a subprocess, but we can verify
    // that the --account flag is accepted by checking stderr does not contain
    // "unknown option". The command itself may fail (no auth), but the flag must
    // be recognized.
    const res = spawnSync("node", ["./dist/cli.js", "--account", "x@y.com", "whoami"], {
      encoding: "utf8",
      env: isolatedEnv,
    })
    expect(res.stdout + res.stderr).not.toMatch(/unknown option/i)
  })
})

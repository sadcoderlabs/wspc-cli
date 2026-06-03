import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
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

  it("`wspc --account ghost@x.com config set` fails with ghost@x.com when only real@x.com exists", () => {
    // End-to-end proof that the preAction hook copies --account into
    // process.env.WSPC_ACCOUNT, which resolveAccount then reads.
    //
    // Strategy: seed a config with account real@x.com, then run with
    // --account ghost@x.com. If the glue works, resolveAccount throws
    // "no account 'ghost@x.com'..." and exits non-zero. If the glue were
    // broken, resolveAccount would fall back to real@x.com and exit 0.
    const seededHome = mkdtempSync(join(tmpdir(), "wspc-cli-e2e-account-"))
    mkdirSync(join(seededHome, ".wspc"), { recursive: true })
    writeFileSync(
      join(seededHome, ".wspc", "config.json"),
      JSON.stringify({
        schema_version: 2,
        current_env: "prod",
        envs: {
          prod: {
            api_base: "https://api.wspc.ai",
            current_account: "real@x.com",
            accounts: {
              "real@x.com": { email: "real@x.com", api_key: "wspc_k" },
            },
          },
        },
      }),
    )
    const seededEnv = { ...process.env, HOME: seededHome, USERPROFILE: seededHome }

    const res = spawnSync(
      "node",
      ["./dist/cli.js", "--account", "ghost@x.com", "config", "set", "actor", "agent"],
      { encoding: "utf8", env: seededEnv },
    )

    // The command MUST fail: ghost@x.com is not in config
    expect(res.status).not.toBe(0)
    // The error message MUST name the unknown account
    expect(res.stdout + res.stderr).toMatch(/no account 'ghost@x\.com'/)
  })
})

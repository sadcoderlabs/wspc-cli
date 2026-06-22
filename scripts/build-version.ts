// scripts/build-version.ts
//
// Regenerates `<rootDir>/src/version.ts` from the locally-committed
// `<rootDir>/spec/openapi.json` — no network access. Runs via the `prepare`
// npm lifecycle after every install so consumers, CI, and a fresh clone all
// get the import target `src/cli.ts` / `src/index.ts` expect; `sync-spec`
// then overwrites the same file when actually pulling from prod.
//
// This exists because `src/version.ts` is gitignored (untracked since
// fix(release): auto-rebuild on npm publish + untrack src/version.ts), and
// CI doesn't have network access to call sync-spec.
import { promises as fs } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { specShaPrefix, STUB_SPEC_SHA, writeVersionFile } from "./version-file.js"

const DEFAULT_API_BASE = "https://api.wspc.ai"

export interface BuildVersionOptions {
  rootDir: string
  apiBase?: string
  now?: () => Date
}

export interface BuildVersionResult {
  /** sha256 prefix derived from the spec, or `"00000000"` when the spec is missing. */
  sha: string
  /** True if no spec was present and a stub file was written instead. */
  stubbed: boolean
}

export async function buildVersion(opts: BuildVersionOptions): Promise<BuildVersionResult> {
  const { rootDir } = opts
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE
  const now = opts.now ?? (() => new Date())
  const pkg = JSON.parse(await fs.readFile(join(rootDir, "package.json"), "utf8")) as {
    version: string
  }

  let sha = STUB_SPEC_SHA
  let stubbed = true
  try {
    const spec = await fs.readFile(join(rootDir, "spec/openapi.json"), "utf8")
    sha = specShaPrefix(spec)
    stubbed = false
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    // First-ever clone where spec hasn't been seeded yet — write a stub so
    // typecheck still runs; sync-spec will fill in real values later.
  }

  await writeVersionFile(rootDir, {
    generatedBy: "scripts/build-version.ts",
    packageVersion: pkg.version,
    specSha: sha,
    fetchedAt: now(),
    apiBase,
  })
  return { sha, stubbed }
}

// CLI entry — only runs when invoked directly (e.g. via the `prepare` script),
// not when this module is imported by tests.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const rootDir = fileURLToPath(new URL("..", import.meta.url))
  const { sha, stubbed } = await buildVersion({ rootDir })
  if (stubbed) {
    console.log("✓ wrote src/version.ts (stub — run `npm run sync-spec` to fetch real spec)")
  } else {
    console.log(`✓ wrote src/version.ts (sha=${sha}, from local spec)`)
  }
}

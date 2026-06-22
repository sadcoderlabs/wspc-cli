// scripts/sync-spec.ts
import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { specShaPrefix, writeVersionFile } from "./version-file.js"

const DEFAULT_URL = "https://api.wspc.ai/openapi.json"

export interface SyncSpecOptions {
  url?: string
  packageVersion: string
  rootDir: string
  fetchImpl?: typeof fetch
  now?: () => Date
}

export async function syncSpec(opts: SyncSpecOptions): Promise<void> {
  const url = opts.url ?? DEFAULT_URL
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())

  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`sync-spec: GET ${url} -> ${res.status}`)
  const body = await res.text()
  const specPath = join(opts.rootDir, "spec/openapi.json")
  await fs.mkdir(dirname(specPath), { recursive: true })
  await fs.writeFile(specPath, body)

  const sha = specShaPrefix(body)
  const baseUrl = new URL(url).origin

  await writeVersionFile(opts.rootDir, {
    generatedBy: "scripts/sync-spec.ts",
    packageVersion: opts.packageVersion,
    specSha: sha,
    fetchedAt: now(),
    apiBase: baseUrl,
  })
}

// CLI entry
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))
  await syncSpec({
    packageVersion: pkg.version,
    rootDir: fileURLToPath(new URL("..", import.meta.url)),
  })
  console.log("✓ spec/openapi.json + src/version.ts updated")
}

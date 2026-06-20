# Drive 桌面 CLI 同步 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `wspc drive bind` and `wspc drive sync once` for safe one-shot whole-file Drive sync.

**Architecture:** Keep sync behavior handwritten because it owns local filesystem safety, state, locking, and raw byte transfer. Use generated SDK for Drive JSON operations after regenerating from the synced OpenAPI spec, and use `loadAuthedFetch` for upload/download streams, matching the existing email attachment pattern. Drive OpenAPI routes currently have no `x-cli` metadata, so the `drive` CLI root is handwritten.

**Tech Stack:** TypeScript, Node 24 stdlib filesystem/path/crypto/stream APIs, Commander, generated WSPC SDK, Vitest.

---

## File Structure

- Modify `src/handwritten/config/index.ts`: add `drive` to consistency bookmark storage.
- Modify `src/cli.ts`: mount a handwritten Drive command tree.
- Create `src/handwritten/commands/drive/state.ts`: state schema, atomic read/write, binding guards, lock helper.
- Create `src/handwritten/commands/drive/path-policy.ts`: POSIX relative path validation and root-safe path resolution.
- Create `src/handwritten/commands/drive/scanner.ts`: local file scan with sha256, symlink/non-regular skip, `.wspc-drive/` exclusion.
- Create `src/handwritten/commands/drive/api.ts`: JSON SDK wrapper plus raw upload/download fetch helpers.
- Create `src/handwritten/commands/drive/decision.ts`: pure decision engine for the sync table.
- Create `src/handwritten/commands/drive/bind.ts`: `wspc drive bind`.
- Create `src/handwritten/commands/drive/sync.ts`: `wspc drive sync once`.
- Add tests under `test/handwritten/drive/*.test.ts`.
- Generated files from `npm run generate` will update `src/generated/**`; do not hand-edit generated files. The current Drive routes generate SDK operations but no generated CLI files because they have no `x-cli` metadata.

## Task 1: Generate Drive SDK and Add Drive Bookmark Storage

**Files:**
- Modify: `src/handwritten/config/index.ts`
- Generated: `src/generated/sdk/*`
- Test: `test/config.test.ts`
- Test: `test/consistency-fetch.test.ts`

- [ ] **Step 1: Write failing config/bookmark tests**

Add coverage that `drive` bookmarks survive config normalization and are injected by the consistency wrapper.

```ts
it("preserves drive consistency bookmarks", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-drive-cfg-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        consistency_bookmarks: { drive: "drive_old" } as never,
        accounts: {},
      },
    },
  })

  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks?.drive).toBe("drive_old")
})
```

```ts
it("injects saved drive bookmark on WSPC API requests", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "wspc-drive-cb-"))
  const store = new ConfigStore({ configDir: dir })
  await store.write({
    current_env: "prod",
    envs: {
      prod: {
        api_base: "https://api.wspc.ai",
        consistency_bookmarks: { drive: "drive_old" } as never,
        accounts: {},
      },
    },
  })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request
    expect(req.headers.get("x-cb-drive")).toBe("drive_old")
    return new Response("{}", { headers: { "x-cb-drive": "drive_new" } })
  })

  const wrapped = createConsistencyFetch({
    store,
    envName: "prod",
    apiBase: "https://api.wspc.ai",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  await wrapped("https://api.wspc.ai/drive/libraries")

  const config = await store.read()
  expect(config.envs.prod?.consistency_bookmarks?.drive).toBe("drive_new")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/config.test.ts test/consistency-fetch.test.ts
```

Expected: FAIL because `drive` is not in `ConsistencyBookmarkService`.

- [ ] **Step 3: Add `drive` to bookmark services**

Change `src/handwritten/config/index.ts`:

```ts
export type ConsistencyBookmarkService = "auth" | "todo" | "calendar" | "drive" | "email" | "push"

const CONSISTENCY_BOOKMARK_SERVICES = ["auth", "todo", "calendar", "drive", "email", "push"] as const
```

- [ ] **Step 4: Generate from the synced OpenAPI spec**

Run:

```bash
npm run generate
```

Expected: PASS and generated Drive SDK operations and types appear under `src/generated/sdk/`. No generated Drive CLI files are expected unless upstream later adds `x-cli` metadata.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- test/config.test.ts test/consistency-fetch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add spec/openapi.json src/generated src/handwritten/config/index.ts test/config.test.ts test/consistency-fetch.test.ts
git commit -m "feat(drive): generate drive api"
```

## Task 2: Folder State and Lock Helpers

**Files:**
- Create: `src/handwritten/commands/drive/state.ts`
- Test: `test/handwritten/drive/state.test.ts`

- [ ] **Step 1: Write failing state tests**

```ts
import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initDriveState, readDriveState, withDriveLock } from "../../../src/handwritten/commands/drive/state.js"

describe("drive state", () => {
  it("creates and reads empty state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_123")
    const state = await readDriveState(root)
    expect(state.library_id).toBe("lib_123")
    expect(state.entries).toEqual({})
    expect(state.conflicts).toEqual({})
  })

  it("refuses a different existing binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_a")
    await expect(initDriveState(root, "lib_b")).rejects.toThrow(/already bound to lib_a/)
  })

  it("ignores temp state files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, ".wspc-drive", "state.json.tmp-test"), "bad json")
    await expect(readDriveState(root)).resolves.toMatchObject({ library_id: "lib_a" })
  })

  it("fails when lock already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-lock-"))
    await initDriveState(root, "lib_a")
    await withDriveLock(root, async () => {
      await expect(withDriveLock(root, async () => undefined)).rejects.toThrow(/sync lock already exists/)
    })
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/state.test.ts
```

Expected: FAIL because `state.ts` does not exist.

- [ ] **Step 3: Add state helper**

Create `src/handwritten/commands/drive/state.ts`:

```ts
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export interface DriveStateEntry {
  entry_id: string
  entry_version: number
  current_version_id?: string
  content_sha256?: string
  size_bytes: number
  last_local_sha256?: string
  last_synced_at: string
  status: "synced"
}

export interface DriveConflict {
  detected_at: string
  reason: string
  remote_entry_version?: number
  remote_version_id?: string
}

export interface DriveState {
  schema_version: 1
  library_id: string
  created_at: string
  updated_at: string
  entries: Record<string, DriveStateEntry>
  conflicts: Record<string, DriveConflict>
}

export const DRIVE_DIR = ".wspc-drive"
export const STATE_FILE = "state.json"

export function statePath(root: string): string {
  return join(root, DRIVE_DIR, STATE_FILE)
}

export async function readDriveState(root: string): Promise<DriveState> {
  const raw = await readFile(statePath(root), "utf8")
  const state = JSON.parse(raw) as DriveState
  if (state.schema_version !== 1 || typeof state.library_id !== "string") {
    throw new Error("unsupported .wspc-drive/state.json schema")
  }
  state.entries ??= {}
  state.conflicts ??= {}
  return state
}

export async function writeDriveState(root: string, state: DriveState): Promise<void> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const tmp = join(root, DRIVE_DIR, `state.json.tmp-${process.pid}-${Date.now()}`)
  const json = JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2) + "\n"
  await writeFile(tmp, json, { mode: 0o600 })
  const fh = await open(tmp, "r")
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, statePath(root))
}

export async function initDriveState(root: string, libraryId: string): Promise<DriveState> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  try {
    const existing = await readDriveState(root)
    if (existing.library_id !== libraryId) {
      throw new Error(`folder already bound to ${existing.library_id}`)
    }
    return existing
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  const now = new Date().toISOString()
  const state: DriveState = {
    schema_version: 1,
    library_id: libraryId,
    created_at: now,
    updated_at: now,
    entries: {},
    conflicts: {},
  }
  await writeDriveState(root, state)
  return state
}

export async function withDriveLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(join(root, DRIVE_DIR), { recursive: true })
  const lock = join(root, DRIVE_DIR, "sync.lock")
  let fh
  try {
    fh = await open(lock, "wx")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("sync lock already exists")
    }
    throw err
  }
  try {
    return await fn()
  } finally {
    await fh.close()
    await rm(lock, { force: true })
  }
}
```

- [ ] **Step 4: Run test**

Run:

```bash
npm test -- test/handwritten/drive/state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/commands/drive/state.ts test/handwritten/drive/state.test.ts
git commit -m "feat(drive): add folder state helpers"
```

## Task 3: Path Policy and Local Scanner

**Files:**
- Create: `src/handwritten/commands/drive/path-policy.ts`
- Create: `src/handwritten/commands/drive/scanner.ts`
- Test: `test/handwritten/drive/path-policy.test.ts`
- Test: `test/handwritten/drive/scanner.test.ts`

- [ ] **Step 1: Write failing path tests**

```ts
import { describe, expect, it } from "vitest"
import { validateDrivePath } from "../../../src/handwritten/commands/drive/path-policy.js"

describe("drive path policy", () => {
  it.each(["/x", "../x", "a//b", "a\\b", "C:\\x", "\\\\server\\share", "a\u0000b"])(
    "rejects unsafe path %s",
    (path) => {
      expect(() => validateDrivePath(path)).toThrow()
    },
  )

  it("accepts normal POSIX relative paths", () => {
    expect(validateDrivePath("notes/today.md")).toBe("notes/today.md")
  })
})
```

- [ ] **Step 2: Write failing scanner tests**

```ts
import { describe, expect, it } from "vitest"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import { scanDriveFiles } from "../../../src/handwritten/commands/drive/scanner.js"

describe("drive scanner", () => {
  it("includes dotfiles and excludes .wspc-drive", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-"))
    await writeFile(join(root, ".env"), "x")
    await mkdir(join(root, ".wspc-drive"))
    await writeFile(join(root, ".wspc-drive", "state.json"), "{}")
    const files = await scanDriveFiles(root)
    expect(Object.keys(files)).toEqual([".env"])
  })

  it("skips symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-scan-"))
    await writeFile(join(root, "target.txt"), "x")
    await symlink(join(root, "target.txt"), join(root, "link.txt"))
    const files = await scanDriveFiles(root)
    expect(Object.keys(files).sort()).toEqual(["target.txt"])
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/path-policy.test.ts test/handwritten/drive/scanner.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Add path policy**

Create `src/handwritten/commands/drive/path-policy.ts`:

```ts
import { resolve, sep } from "node:path"

const CONTROL = /[\u0000-\u001f\u007f]/

export function validateDrivePath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("..")) {
    throw new Error(`invalid drive path: ${path}`)
  }
  if (/^[A-Za-z]:/.test(path) || path.startsWith("//") || CONTROL.test(path)) {
    throw new Error(`invalid drive path: ${path}`)
  }
  const segments = path.split("/")
  if (segments.some((s) => s.length === 0 || s === "." || s === "..")) {
    throw new Error(`invalid drive path: ${path}`)
  }
  if (Buffer.byteLength(path, "utf8") > 1024) throw new Error(`drive path too long: ${path}`)
  for (const segment of segments) {
    if (Buffer.byteLength(segment, "utf8") > 255) throw new Error(`drive path segment too long: ${path}`)
  }
  return path
}

export function resolveInsideRoot(root: string, drivePath: string): string {
  const valid = validateDrivePath(drivePath)
  const absRoot = resolve(root)
  const target = resolve(absRoot, ...valid.split("/"))
  if (target !== absRoot && !target.startsWith(absRoot + sep)) {
    throw new Error(`drive path escapes root: ${drivePath}`)
  }
  return target
}
```

- [ ] **Step 5: Add scanner**

Create `src/handwritten/commands/drive/scanner.ts`:

```ts
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { validateDrivePath } from "./path-policy.js"

export interface LocalDriveFile {
  path: string
  sha256: string
  size_bytes: number
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve)
  })
  return hash.digest("hex")
}

export async function scanDriveFiles(root: string): Promise<Record<string, LocalDriveFile>> {
  const out: Record<string, LocalDriveFile> = {}
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      if (dir === root && name === ".wspc-drive") continue
      const abs = join(dir, name)
      const st = await lstat(abs)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!st.isFile()) continue
      const rel = relative(root, abs).split(sep).join("/")
      const path = validateDrivePath(rel)
      out[path] = { path, sha256: await sha256File(abs), size_bytes: st.size }
    }
  }
  await walk(root)
  return out
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- test/handwritten/drive/path-policy.test.ts test/handwritten/drive/scanner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/handwritten/commands/drive/path-policy.ts src/handwritten/commands/drive/scanner.ts test/handwritten/drive/path-policy.test.ts test/handwritten/drive/scanner.test.ts
git commit -m "feat(drive): add path scanner"
```

## Task 4: Drive API Boundary

**Files:**
- Create: `src/handwritten/commands/drive/api.ts`
- Test: `test/handwritten/drive/api.test.ts`

- [ ] **Step 1: Write failing API tests**

```ts
import { describe, expect, it, vi } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../../../src/handwritten/config/index.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"

describe("drive api", () => {
  it("uses authed fetch for upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wspc-drive-api-"))
    const store = new ConfigStore({ configDir: dir })
    await store.write({
      current_env: "prod",
      envs: {
        prod: {
          api_base: "https://api.wspc.ai",
          current_account: "a@x.com",
          accounts: { "a@x.com": { email: "a@x.com", api_key: "wspc_x" } },
        },
      },
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      expect(req.method).toBe("PUT")
      expect(req.url).toContain("/drive/libraries/lib_a/files/content")
      expect(req.headers.get("authorization")).toBe("Bearer wspc_x")
      return new Response(JSON.stringify({ entry: { id: "fil_a", path: "a.txt", kind: "file", entry_version: 1, size_bytes: 1, updated_at: "now" }, result: "created" }), {
        headers: { "content-type": "application/json" },
      })
    })
    const api = await createDriveApi({ store, fetchImpl: fetchImpl as unknown as typeof fetch })
    const res = await api.uploadFile("lib_a", "a.txt", 0, new Uint8Array([97]), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb")
    expect(res.result).toBe("created")
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/api.test.ts
```

Expected: FAIL because `api.ts` does not exist.

- [ ] **Step 3: Add API wrapper**

Create `src/handwritten/commands/drive/api.ts`:

```ts
import { driveFileDelete, driveLibraryGet, driveManifestGet } from "../../../generated/sdk/index.js"
import { ConfigStore } from "../../config/index.js"
import { loadAuthedFetch, loadSdkClient } from "../../auth/load-sdk-client.js"

export async function createDriveApi(opts: { store?: ConfigStore; fetchImpl?: typeof fetch } = {}) {
  const client = await loadSdkClient(opts)
  const authed = await loadAuthedFetch(opts)

  return {
    async getLibrary(id: string) {
      const res = await driveLibraryGet({ client: client._rawClient, path: { id } } as never)
      if (res.error || !res.response?.ok || !res.data) throw new Error(`HTTP ${res.response?.status ?? "?"}: ${JSON.stringify(res.error)}`)
      return res.data
    },
    async getManifest(id: string, cursor?: string) {
      const res = await driveManifestGet({ client: client._rawClient, path: { id }, query: { cursor } } as never)
      if (res.error || !res.response?.ok || !res.data) throw new Error(`HTTP ${res.response?.status ?? "?"}: ${JSON.stringify(res.error)}`)
      return res.data
    },
    async deleteFile(id: string, path: string, expectedEntryVersion: number) {
      const res = await driveFileDelete({
        client: client._rawClient,
        path: { id },
        body: { path, expected_entry_version: expectedEntryVersion },
      } as never)
      if (res.error || !res.response?.ok || !res.data) throw new Error(`HTTP ${res.response?.status ?? "?"}: ${JSON.stringify(res.error)}`)
      return res.data
    },
    async uploadFile(id: string, path: string, expectedEntryVersion: number, body: Uint8Array, sha256: string) {
      const url = new URL(`/drive/libraries/${id}/files/content`, authed.baseUrl)
      url.searchParams.set("path", path)
      url.searchParams.set("expected_entry_version", String(expectedEntryVersion))
      const res = await authed.fetch(url, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-drive-content-sha256": sha256,
        },
        body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return (await res.json()) as { entry: { id: string; path: string; entry_version: number; current_version_id?: string; content_sha256?: string; size_bytes: number; updated_at: string }; result: string }
    },
    async downloadFile(id: string, path: string) {
      const url = new URL(`/drive/libraries/${id}/files/content`, authed.baseUrl)
      url.searchParams.set("path", path)
      const res = await authed.fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return res
    },
  }
}
```

- [ ] **Step 4: Run test**

Run:

```bash
npm test -- test/handwritten/drive/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/commands/drive/api.ts test/handwritten/drive/api.test.ts
git commit -m "feat(drive): add api boundary"
```

## Task 5: Pure Sync Decision Engine

**Files:**
- Create: `src/handwritten/commands/drive/decision.ts`
- Test: `test/handwritten/drive/decision.test.ts`

- [ ] **Step 1: Write failing table-driven test**

```ts
import { describe, expect, it } from "vitest"
import { decideDriveAction } from "../../../src/handwritten/commands/drive/decision.js"

const base = { entry_version: 1, content_sha256: "old", last_local_sha256: "old" }

describe("drive decision", () => {
  it.each([
    ["new local", undefined, { sha256: "a" }, undefined, "upload_create"],
    ["new remote", undefined, undefined, { content_sha256: "a" }, "download"],
    ["same first sight", undefined, { sha256: "a" }, { content_sha256: "a" }, "state_only"],
    ["different first sight", undefined, { sha256: "a" }, { content_sha256: "b" }, "conflict"],
    ["delete remote", base, undefined, { content_sha256: "old", entry_version: 1 }, "delete_remote"],
    ["download changed remote", base, { sha256: "old" }, { content_sha256: "new", entry_version: 2 }, "download"],
    ["upload changed local", base, { sha256: "new" }, { content_sha256: "old", entry_version: 1 }, "upload_update"],
    ["both changed", base, { sha256: "new" }, { content_sha256: "remote", entry_version: 2 }, "conflict"],
    ["remove gone", base, undefined, undefined, "remove_state"],
  ])("%s", (_name, entry, local, remote, action) => {
    expect(decideDriveAction(entry as never, local as never, remote as never).type).toBe(action)
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/decision.test.ts
```

Expected: FAIL because `decision.ts` does not exist.

- [ ] **Step 3: Add decision engine**

Create `src/handwritten/commands/drive/decision.ts`:

```ts
export type DriveAction =
  | { type: "upload_create"; expectedEntryVersion: 0 }
  | { type: "upload_update"; expectedEntryVersion: number }
  | { type: "download" }
  | { type: "delete_remote"; expectedEntryVersion: number }
  | { type: "state_only" }
  | { type: "remove_state" }
  | { type: "conflict"; reason: string }
  | { type: "unchanged" }

export interface DecisionEntry {
  entry_version: number
  content_sha256?: string
  last_local_sha256?: string
}

export interface DecisionLocal {
  sha256: string
}

export interface DecisionRemote {
  content_sha256?: string
  entry_version?: number
}

export function decideDriveAction(
  entry: DecisionEntry | undefined,
  local: DecisionLocal | undefined,
  remote: DecisionRemote | undefined,
): DriveAction {
  if (!entry) {
    if (local && !remote) return { type: "upload_create", expectedEntryVersion: 0 }
    if (!local && remote) return { type: "download" }
    if (local && remote) return local.sha256 === remote.content_sha256 ? { type: "state_only" } : { type: "conflict", reason: "local_and_remote_without_base" }
    return { type: "unchanged" }
  }

  if (!local && !remote) return { type: "remove_state" }
  const localUnchanged = !local || local.sha256 === entry.last_local_sha256
  const remoteUnchanged = !remote || remote.content_sha256 === entry.content_sha256

  if (!local && remoteUnchanged) return { type: "delete_remote", expectedEntryVersion: entry.entry_version }
  if (!local && !remoteUnchanged) return { type: "conflict", reason: "remote_changed_before_delete" }
  if (local && !remote) return localUnchanged ? { type: "delete_remote", expectedEntryVersion: entry.entry_version } : { type: "upload_update", expectedEntryVersion: entry.entry_version }
  if (local && remote && localUnchanged && !remoteUnchanged) return { type: "download" }
  if (local && remote && !localUnchanged && remoteUnchanged) return { type: "upload_update", expectedEntryVersion: entry.entry_version }
  if (local && remote && !localUnchanged && !remoteUnchanged) return { type: "conflict", reason: "local_and_remote_changed" }
  return { type: "unchanged" }
}
```

- [ ] **Step 4: Run test**

Run:

```bash
npm test -- test/handwritten/drive/decision.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handwritten/commands/drive/decision.ts test/handwritten/drive/decision.test.ts
git commit -m "feat(drive): add sync decision engine"
```

## Task 6: `wspc drive bind`

**Files:**
- Create: `src/handwritten/commands/drive/bind.ts`
- Modify: `src/cli.ts`
- Test: `test/handwritten/drive/bind.test.ts`

- [ ] **Step 1: Write failing command test**

```ts
import { describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { driveBindCommand } from "../../../src/handwritten/commands/drive/bind.js"
import { createDriveApi } from "../../../src/handwritten/commands/drive/api.js"

vi.mock("../../../src/handwritten/commands/drive/api.js", () => ({
  createDriveApi: vi.fn(async () => ({
    getLibrary: vi.fn(async () => ({ id: "lib_a", name: "Docs" })),
  })),
}))

describe("drive bind", () => {
  it("validates library and writes state", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-bind-"))
    const cmd = driveBindCommand()
    await cmd.parseAsync(["node", "test", "--library", "lib_a", root])
    const state = JSON.parse(await readFile(join(root, ".wspc-drive", "state.json"), "utf8"))
    expect(state.library_id).toBe("lib_a")
    expect(createDriveApi).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/bind.test.ts
```

Expected: FAIL because `bind.ts` does not exist.

- [ ] **Step 3: Add bind command**

Create `src/handwritten/commands/drive/bind.ts`:

```ts
import { Command } from "commander"
import { resolve } from "node:path"
import { createDriveApi } from "./api.js"
import { initDriveState } from "./state.js"
import { render } from "../../output/render.js"

export function driveBindCommand(): Command {
  return new Command("bind")
    .description("Bind a local folder to an existing Drive library")
    .requiredOption("--library <id>", "existing Drive library id")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string, opts: { library: string }) => {
      const root = resolve(path)
      const api = await createDriveApi()
      const library = await api.getLibrary(opts.library)
      const state = await initDriveState(root, opts.library)
      render({ kind: "drive_bind", display: { shape: "object" } }, {
        root,
        library_id: state.library_id,
        library_name: (library as { name?: string }).name,
        next: `wspc drive sync once ${root}`,
      })
    })
}
```

- [ ] **Step 4: Mount command in `src/cli.ts`**

Add import:

```ts
import { driveBindCommand } from "./handwritten/commands/drive/bind.js"
```

After generated commands are registered:

```ts
  const drive = new Command("drive").description("Drive commands")
  drive.addCommand(driveBindCommand())
  program.addCommand(drive)
```

- [ ] **Step 5: Run test**

Run:

```bash
npm test -- test/handwritten/drive/bind.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/handwritten/commands/drive/bind.ts test/handwritten/drive/bind.test.ts
git commit -m "feat(drive): add bind command"
```

## Task 7: `wspc drive sync once`

**Files:**
- Create: `src/handwritten/commands/drive/sync.ts`
- Modify: `src/cli.ts`
- Test: `test/handwritten/drive/sync.test.ts`

- [ ] **Step 1: Write failing sync smoke test**

```ts
import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initDriveState } from "../../../src/handwritten/commands/drive/state.js"
import { runDriveSyncOnce } from "../../../src/handwritten/commands/drive/sync.js"

describe("drive sync once", () => {
  it("uploads a new local file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-"))
    await initDriveState(root, "lib_a")
    await writeFile(join(root, "a.txt"), "a")
    const uploads: string[] = []
    const result = await runDriveSyncOnce(root, {
      getManifest: async () => ({ library: { id: "lib_a" }, entries: [], next_cursor: null }),
      uploadFile: async (_lib, path) => {
        uploads.push(path)
        return { entry: { id: "fil_a", path, kind: "file", entry_version: 1, current_version_id: "fvr_a", content_sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", size_bytes: 1, updated_at: "now" }, result: "created" }
      },
      downloadFile: async () => new Response(""),
      deleteFile: async () => ({ entry: { id: "fil_a", path: "a.txt", kind: "file", entry_version: 2, size_bytes: 1, updated_at: "now" }, result: "deleted" }),
    } as never)
    expect(uploads).toEqual(["a.txt"])
    expect(result.uploaded).toBe(1)
    const state = JSON.parse(await readFile(join(root, ".wspc-drive", "state.json"), "utf8"))
    expect(state.entries["a.txt"].entry_version).toBe(1)
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/handwritten/drive/sync.test.ts
```

Expected: FAIL because `sync.ts` does not exist.

- [ ] **Step 3: Add sync command module**

Create `src/handwritten/commands/drive/sync.ts`:

```ts
import { Command } from "commander"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createDriveApi } from "./api.js"
import { decideDriveAction } from "./decision.js"
import { resolveInsideRoot } from "./path-policy.js"
import { scanDriveFiles } from "./scanner.js"
import { readDriveState, withDriveLock, writeDriveState, type DriveState } from "./state.js"
import { render } from "../../output/render.js"

export interface SyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  unchanged: number
  conflicts: number
  errors: number
  paths: Array<{ path: string; action: string }>
}

export async function runDriveSyncOnce(root: string, api = await createDriveApi()): Promise<SyncSummary> {
  return withDriveLock(root, async () => {
    const state = await readDriveState(root)
    const local = await scanDriveFiles(root)
    const manifest = await api.getManifest(state.library_id)
    const remote = Object.fromEntries((manifest.entries ?? []).map((e: { path: string }) => [e.path, e]))
    const paths = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(state.entries)])].sort()
    const summary: SyncSummary = { uploaded: 0, downloaded: 0, deleted: 0, unchanged: 0, conflicts: 0, errors: 0, paths: [] }

    for (const path of paths) {
      const action = decideDriveAction(state.entries[path], local[path], remote[path])
      summary.paths.push({ path, action: action.type })
      try {
        await applyAction(root, state, api, path, action, local[path], remote[path])
        if (action.type === "upload_create" || action.type === "upload_update") summary.uploaded++
        else if (action.type === "download") summary.downloaded++
        else if (action.type === "delete_remote") summary.deleted++
        else if (action.type === "conflict") summary.conflicts++
        else summary.unchanged++
        await writeDriveState(root, state)
      } catch (err) {
        state.conflicts[path] = { detected_at: new Date().toISOString(), reason: (err as Error).message }
        summary.errors++
        await writeDriveState(root, state)
      }
    }
    return summary
  })
}

async function applyAction(root: string, state: DriveState, api: Awaited<ReturnType<typeof createDriveApi>>, path: string, action: { type: string; expectedEntryVersion?: number; reason?: string }, local: { sha256: string; size_bytes: number } | undefined, remote: { id: string; entry_version: number; current_version_id?: string; content_sha256?: string; size_bytes: number; updated_at: string } | undefined): Promise<void> {
  if (action.type === "conflict") {
    state.conflicts[path] = { detected_at: new Date().toISOString(), reason: action.reason ?? "conflict", remote_entry_version: remote?.entry_version, remote_version_id: remote?.current_version_id }
    return
  }
  if (action.type === "remove_state") {
    delete state.entries[path]
    delete state.conflicts[path]
    return
  }
  if (action.type === "upload_create" || action.type === "upload_update") {
    if (!local) throw new Error("missing local file for upload")
    const body = await readFile(resolveInsideRoot(root, path))
    const res = await api.uploadFile(state.library_id, path, action.expectedEntryVersion ?? 0, body, local.sha256)
    state.entries[path] = {
      entry_id: res.entry.id,
      entry_version: res.entry.entry_version,
      current_version_id: res.entry.current_version_id,
      content_sha256: res.entry.content_sha256,
      size_bytes: res.entry.size_bytes,
      last_local_sha256: local.sha256,
      last_synced_at: new Date().toISOString(),
      status: "synced",
    }
    delete state.conflicts[path]
    return
  }
  if (action.type === "download") {
    if (!remote) throw new Error("missing remote file for download")
    const target = resolveInsideRoot(root, path)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.wspc-download-${process.pid}-${Date.now()}`
    const res = await api.downloadFile(state.library_id, path)
    if (!res.body) throw new Error("download response has no body")
    await pipeline(Readable.fromWeb(res.body as never), await import("node:fs").then((fs) => fs.createWriteStream(tmp)))
    await rename(tmp, target)
    state.entries[path] = {
      entry_id: remote.id,
      entry_version: remote.entry_version,
      current_version_id: remote.current_version_id,
      content_sha256: remote.content_sha256,
      size_bytes: remote.size_bytes,
      last_local_sha256: remote.content_sha256,
      last_synced_at: new Date().toISOString(),
      status: "synced",
    }
    delete state.conflicts[path]
    return
  }
  if (action.type === "delete_remote") {
    const entry = state.entries[path]
    if (!entry) throw new Error("missing state entry for delete")
    await api.deleteFile(state.library_id, path, entry.entry_version)
    await rm(resolveInsideRoot(root, path), { force: true })
    delete state.entries[path]
    delete state.conflicts[path]
  }
}

export function driveSyncCommand(): Command {
  const sync = new Command("sync").description("Drive sync commands")
  sync
    .command("once")
    .argument("[path]", "local folder path", ".")
    .description("Run one Drive sync pass")
    .action(async (path: string) => {
      const summary = await runDriveSyncOnce(resolve(path))
      render({ kind: "drive_sync_once", display: { shape: "object" } }, summary)
      if (summary.conflicts > 0 || summary.errors > 0) process.exitCode = 1
    })
  return sync
}
```

- [ ] **Step 4: Mount sync command in `src/cli.ts`**

Add import:

```ts
import { driveSyncCommand } from "./handwritten/commands/drive/sync.js"
```

Add beside `driveBindCommand()`:

```ts
  drive.addCommand(driveSyncCommand())
```

- [ ] **Step 5: Run sync tests**

Run:

```bash
npm test -- test/handwritten/drive/sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused Drive tests**

Run:

```bash
npm test -- test/handwritten/drive
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/handwritten/commands/drive/sync.ts test/handwritten/drive/sync.test.ts
git commit -m "feat(drive): add sync once"
```

## Task 8: Final Verification and README Notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README command notes**

Add a Drive section:

```md
## Drive sync

Bind a local folder to an existing Drive library:

```bash
wspc drive bind --library lib_xxx ./notes
wspc drive sync once ./notes
```

`bind` does not create a library. It verifies the existing library, writes `.wspc-drive/state.json`, and waits for an explicit `sync once`.
```

- [ ] **Step 2: Run full checks**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add drive sync commands"
```

## Self-Review

- Spec coverage: `bind`, `sync once`, generated JSON boundary, direct raw transfer, local state, lock, path policy, decision table, errors, output, tests, and out-of-scope watch/init are covered.
- Placeholder scan: no placeholder markers or unspecified edge-handling steps remain.
- Type consistency: `DriveState`, `DriveAction`, `LocalDriveFile`, `createDriveApi`, `driveBindCommand`, and `runDriveSyncOnce` names are introduced before later tasks use them.

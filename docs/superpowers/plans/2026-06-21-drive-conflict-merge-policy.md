# Drive 衝突與合併策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 `wspc drive sync once` / `wspc drive watch` sync engine 中加入安全的 M4 conflict UX：小型 UTF-8 文字檔 clean 3-way merge，其他衝突保留資料並建立 conflict copy 或 conflict record。

**Architecture:** `decision.ts` 繼續只決定粗略 action；`sync.ts` 在 `conflict` action 中呼叫新的 conflict resolver，讓 watch 自然沿用更新後 summary。新增 `merge.ts` 放文字分類、line merge、conflict copy 命名與寫入 helper；`api.ts` 只做 versioned download 的最小擴充；`state.ts` 只擴充 optional conflict metadata，保持 `schema_version: 1`。

**Tech Stack:** TypeScript、Vitest、Node fs/path/crypto、`node-diff3`、既有 Drive API wrapper。

---

## File Structure

- Modify: `package.json`、`package-lock.json`，加入 `node-diff3` runtime dependency。
- Modify: `src/handwritten/commands/drive/api.ts`，讓 `downloadFile(id, path, versionId?)` 支援 `version_id` query。
- Modify: `src/handwritten/commands/drive/state.ts`，擴充 `DriveConflict` optional metadata 與 schema guard。
- Create: `src/handwritten/commands/drive/merge.ts`，集中 mergeable text classification、clean 3-way merge、newline selection、conflict copy path/write helper。
- Modify: `src/handwritten/commands/drive/sync.ts`，擴充 summary、conflict action processing、merged upload、delete/edit conflict behavior。
- Modify: `test/handwritten/drive/api.test.ts`、`test/handwritten/drive/state.test.ts`、`test/handwritten/drive/sync.test.ts`。
- Create: `test/handwritten/drive/merge.test.ts`。

### Task 1: Dependency And Versioned Download

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/handwritten/commands/drive/api.ts`
- Modify: `test/handwritten/drive/api.test.ts`

- [ ] **Step 1: Install `node-diff3`**

Run:

```bash
npm install node-diff3
```

Expected: `package.json` contains `"node-diff3"` under dependencies and `package-lock.json` is updated.

- [ ] **Step 2: Write failing API test for versioned download**

In `test/handwritten/drive/api.test.ts`, add:

```ts
it("downloadFile includes version_id when provided", async () => {
  const fetchImpl = vi.fn(async () => new Response("base", { status: 200 })) as typeof fetch
  const api = await mkDriveApi(fetchImpl)

  await api.downloadFile("lib_1", "notes/today.md", "ver_base")

  const url = new URL(String(fetchImpl.mock.calls[0]![0]))
  expect(url.pathname).toBe("/drive/libraries/lib_1/files/content")
  expect(url.searchParams.get("path")).toBe("notes/today.md")
  expect(url.searchParams.get("version_id")).toBe("ver_base")
})
```

Use the existing `mkDriveApi(fetchImpl)` helper in `test/handwritten/drive/api.test.ts`.

- [ ] **Step 3: Run API test and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/api.test.ts
```

Expected: FAIL because `downloadFile` does not accept or emit `version_id`.

- [ ] **Step 4: Implement versioned download**

Change `downloadFile` in `src/handwritten/commands/drive/api.ts`:

```ts
async downloadFile(id: string, path: string, versionId?: string): Promise<Response> {
  const url = driveContentUrl(client.baseUrl, id)
  url.searchParams.set("path", path)
  if (versionId !== undefined) {
    url.searchParams.set("version_id", versionId)
  }
  const res = await client.fetch(url, { method: "GET" })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res
}
```

Also update `DriveSyncApi.downloadFile` in `src/handwritten/commands/drive/sync.ts` to:

```ts
downloadFile(id: string, path: string, versionId?: string): Promise<Response>
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/api.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add package.json package-lock.json src/handwritten/commands/drive/api.ts src/handwritten/commands/drive/sync.ts test/handwritten/drive/api.test.ts
git commit -m "feat(drive): support versioned downloads"
```

### Task 2: State Metadata And Summary Shape

**Files:**
- Modify: `src/handwritten/commands/drive/state.ts`
- Modify: `src/handwritten/commands/drive/sync.ts`
- Modify: `test/handwritten/drive/state.test.ts`
- Modify: `test/handwritten/drive/sync.test.ts`

- [ ] **Step 1: Write failing state schema test**

In `test/handwritten/drive/state.test.ts`, add a test that writes state with extended conflict metadata and verifies `readDriveState()` accepts it:

```ts
it("accepts extended conflict metadata while preserving schema version 1", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-state-conflict-meta-"))
  await mkdir(join(root, ".wspc-drive"), { recursive: true })
  await writeFile(join(root, ".wspc-drive", "state.json"), JSON.stringify({
    schema_version: 1,
    library_id: "lib_1",
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    entries: {},
    conflicts: {
      "notes/today.md": {
        detected_at: "2026-06-21T10:10:00.000Z",
        reason: "local_and_remote_changed",
        type: "edit_edit",
        strategy: "conflict_copy",
        base_version_id: "ver_base",
        remote_version_id: "ver_remote",
        remote_entry_version: 9,
        conflict_paths: ["notes/today.remote-conflict-20260621T101000Z.ver_remo.md"],
      },
    },
  }))

  expect((await readDriveState(root)).conflicts["notes/today.md"]).toMatchObject({
    type: "edit_edit",
    strategy: "conflict_copy",
    conflict_paths: ["notes/today.remote-conflict-20260621T101000Z.ver_remo.md"],
  })
})
```

- [ ] **Step 2: Write failing summary shape test**

In `test/handwritten/drive/sync.test.ts`, add a small type-level/runtime assertion near summary tests:

```ts
it("includes merged count and conflict copy metadata in sync summaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-summary-shape-"))
  await initDriveState(root, "lib_1")
  const api = mkApi([{ entries: [] }])

  const result = await runDriveSyncOnce(root, api)

  expect(result.merged).toBe(0)
  expect(result.conflict_paths).toEqual([])
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/sync.test.ts
```

Expected: FAIL because state guard rejects extra fields or summary lacks `merged` / `conflict_paths`.

- [ ] **Step 4: Implement state and summary extensions**

In `src/handwritten/commands/drive/state.ts`, extend `DriveConflict`:

```ts
export interface DriveConflict {
  detected_at: string
  reason: string
  type?: "edit_edit" | "create_create" | "delete_edit" | "edit_delete"
  strategy?: "clean_merge" | "conflict_copy" | "record_only"
  base_version_id?: string
  remote_entry_version?: number
  remote_version_id?: string
  conflict_paths?: string[]
}
```

Update `isDriveConflict()` to accept each optional field only when it has the expected type, and `conflict_paths` only when every item is a string.

In `src/handwritten/commands/drive/sync.ts`, extend:

```ts
export interface DriveSyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  unchanged: number
  merged: number
  conflicts: number
  errors: number
  conflict_paths: string[]
  paths: Array<{ path: string; action: DriveSyncPathAction; conflict_paths?: string[] }>
}
```

Add `merged: 0` and `conflict_paths: []` to `emptySummary()`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/sync.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/handwritten/commands/drive/state.ts src/handwritten/commands/drive/sync.ts test/handwritten/drive/state.test.ts test/handwritten/drive/sync.test.ts
git commit -m "feat(drive): extend conflict state metadata"
```

### Task 3: Merge Helpers

**Files:**
- Create: `src/handwritten/commands/drive/merge.ts`
- Create: `test/handwritten/drive/merge.test.ts`

- [ ] **Step 1: Write failing classification tests**

Create `test/handwritten/drive/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { classifyMergeText, mergeText3, conflictCopyPath } from "../../../src/handwritten/commands/drive/merge.js"

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
    const result = mergeText3("a\nb\n", "a\r\nlocal\r\nb\r\n", "a\nremote\nb\n")
    expect(result).toEqual({ clean: true, text: "a\r\nlocal\r\nremote\r\nb\r\n" })
  })

  it("reports hunk conflicts without conflict markers", () => {
    const result = mergeText3("a\nold\n", "a\nlocal\n", "a\nremote\n")
    expect(result.clean).toBe(false)
    expect("text" in result).toBe(false)
  })

  it("builds conflict copy paths next to the original path", () => {
    expect(conflictCopyPath("notes/today.md", "remote", new Date("2026-06-21T10:10:00Z"), "ver_remote")).toBe(
      "notes/today.remote-conflict-20260621T101000Z.ver_remo.md",
    )
  })
})
```

- [ ] **Step 2: Run merge tests and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/merge.test.ts
```

Expected: FAIL because `merge.ts` does not exist.

- [ ] **Step 3: Implement merge helper module**

Create `src/handwritten/commands/drive/merge.ts` with these exported signatures:

```ts
export type ConflictSide = "remote" | "local"
export type MergeTextClassification = { mergeable: true; text: string } | { mergeable: false; reason: string }
export type MergeTextResult = { clean: true; text: string } | { clean: false }

export function classifyMergeText(path: string, bytes: Uint8Array, mimeType?: string): MergeTextClassification
export function mergeText3(base: string, local: string, remote: string): MergeTextResult
export function conflictCopyPath(path: string, side: ConflictSide, now: Date, versionId: string): string
```

Implementation requirements:
- Limit size to `1024 * 1024`.
- Strict UTF-8 decode with `new TextDecoder("utf-8", { fatal: true })`.
- Sniff the first `8192` bytes for NUL and control-character ratio; allow tab, LF, CR.
- Allow extensions from the spec list or `mimeType?.startsWith("text/")`.
- Use `node-diff3` for line merge.
- Preserve local newline style: if local contains `\r\n`, output `\r\n`; otherwise `\n`.
- Do not return conflict markers for unclean merge.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/merge.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/handwritten/commands/drive/merge.ts test/handwritten/drive/merge.test.ts
git commit -m "feat(drive): add merge classification helpers"
```

### Task 4: Clean Edit/Edit Merge

**Files:**
- Modify: `src/handwritten/commands/drive/sync.ts`
- Modify: `test/handwritten/drive/sync.test.ts`

- [ ] **Step 1: Write failing clean merge tests**

In `test/handwritten/drive/sync.test.ts`, add:

```ts
it("clean merges local and remote text edits, uploads merged content with remote entry version, and updates state", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-clean-merge-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "a\nb\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "a\nlocal\nb\n")
  const remote = entry("notes.md", "a\nremote\nb\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "a\nb\n")
  api.downloads.set("notes.md@ver_2", "a\nremote\nb\n")

  const result = await runDriveSyncOnce(root, api)

  expect(result.merged).toBe(1)
  expect(result.conflicts).toBe(0)
  expect(api.uploads).toEqual([{ id: "lib_1", path: "notes.md", sha256: sha256("a\nlocal\nremote\nb\n"), expectedEntryVersion: 2 }])
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("a\nlocal\nremote\nb\n")
  expect((await readDriveState(root)).conflicts["notes.md"]).toBeUndefined()
})
```

Update `mkApi.downloadFile` to honor `versionId`:

```ts
async downloadFile(_id, path, versionId) {
  const key = versionId === undefined ? path : `${path}@${versionId}`
  const content = downloads.get(key)
  if (content === undefined) throw new Error(`missing test download: ${key}`)
  return new Response(content)
}
```

- [ ] **Step 2: Run sync test and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts -t "clean merges"
```

Expected: FAIL because conflict action only records a conflict.

- [ ] **Step 3: Implement clean merge path**

In `src/handwritten/commands/drive/sync.ts`:
- Add `merged` to `DriveSyncPathAction`.
- In `action.type === "conflict"`, call `tryResolveConflict()` for `local_and_remote_changed`.
- `tryResolveConflict()` must:
  - require `state.entries[path].current_version_id` and `remote.current_version_id`.
  - download base with `api.downloadFile(libraryId, path, baseVersionId)`.
  - download remote with `api.downloadFile(libraryId, path, remote.current_version_id)`.
  - read local bytes from `resolveInsideRoot(root, path)`.
  - classify all three with `classifyMergeText(path, bytes, undefined)`.
  - use `mergeText3()`.
  - before writing merged bytes, hash local file and compare to scanned local hash.
  - write merged bytes via temp file + rename.
  - upload with `expectedEntryVersion = remote.entry_version`.
  - on success update `entries[path]`, delete `conflicts[path]`, increment `summary.merged`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts -t "clean merges"
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/handwritten/commands/drive/sync.ts test/handwritten/drive/sync.test.ts
git commit -m "feat(drive): clean merge text conflicts"
```

### Task 5: Conflict Copy Fallbacks

**Files:**
- Modify: `src/handwritten/commands/drive/sync.ts`
- Modify: `test/handwritten/drive/sync.test.ts`

- [ ] **Step 1: Write failing conflict copy tests**

Add tests for:

```ts
it("writes a remote conflict copy for unclean edit/edit merges without changing the canonical local file", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "local\n")
  const remote = entry("notes.md", "remote\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "old\n")
  api.downloads.set("notes.md@ver_2", "remote\n")

  const result = await runDriveSyncOnce(root, api)

  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
  expect(result.conflicts).toBe(1)
  expect(result.conflict_paths[0]).toMatch(/^notes\.remote-conflict-\d{8}T\d{6}Z\.ver_2\.md$/)
  expect(await readFile(join(root, result.conflict_paths[0]!), "utf8")).toBe("remote\n")
  expect(api.uploads).toEqual([])
})

it("adds a numeric suffix when the conflict copy path already exists", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-06-21T10:10:00Z"))
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-conflict-copy-suffix-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "local\n")
  await writeFile(join(root, "notes.remote-conflict-20260621T101000Z.ver_2.md"), "existing")
  const remote = entry("notes.md", "remote\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "old\n")
  api.downloads.set("notes.md@ver_2", "remote\n")

  const result = await runDriveSyncOnce(root, api)

  expect(result.conflict_paths).toEqual(["notes.remote-conflict-20260621T101000Z.ver_2-2.md"])
  expect(await readFile(join(root, "notes.remote-conflict-20260621T101000Z.ver_2-2.md"), "utf8")).toBe("remote\n")
  vi.useRealTimers()
})
```

Fill the second test with the same state/API setup as the first test.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts -t "conflict copy"
```

Expected: FAIL because conflict copies are not written.

- [ ] **Step 3: Implement conflict copy writes**

In `src/handwritten/commands/drive/sync.ts`:
- Add `writeConflictCopy(root, path, side, versionId, bytes)` using `conflictCopyPath()`.
- Use exclusive create via temp file + `link`/rename pattern that never overwrites an existing path.
- Retry with `-2`, `-3` suffix when the candidate exists.
- Validate every candidate with `validateDrivePath()` and `resolveInsideRoot()`.
- Record conflict metadata:

```ts
nextState.conflicts[path] = {
  detected_at: new Date().toISOString(),
  reason,
  type: "edit_edit",
  strategy: "conflict_copy",
  base_version_id: entry.current_version_id,
  remote_version_id: remote.current_version_id,
  remote_entry_version: remote.entry_version,
  conflict_paths: [copyPath],
}
```

Also push copy paths into `summary.conflict_paths` and the per-path result.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts -t "conflict copy"
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/handwritten/commands/drive/sync.ts test/handwritten/drive/sync.test.ts
git commit -m "feat(drive): write conflict copies"
```

### Task 6: Missing Base, Delete/Edit, And Race Guards

**Files:**
- Modify: `src/handwritten/commands/drive/sync.ts`
- Modify: `test/handwritten/drive/sync.test.ts`

- [ ] **Step 1: Add failing tests for non-cleanable conflicts**

Add tests for these cases:

```ts
it("records conflict copy when base version id is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-missing-base-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = { ...stateEntry("notes.md", "base\n", 1), current_version_id: undefined }
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "local\n")
  const remote = entry("notes.md", "remote\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_2", "remote\n")
  const result = await runDriveSyncOnce(root, api)
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
  expect(result.conflict_paths[0]).toContain("remote-conflict")
  expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({ strategy: "conflict_copy" })
})

it("records remote tombstone conflict when local changed and remote deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-edit-delete-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "base\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "local\n")
  const api = mkApi([{ entries: [] }])
  const result = await runDriveSyncOnce(root, api)
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("local\n")
  expect(api.uploads).toEqual([])
  expect(result.conflicts).toBe(1)
  expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({ strategy: "record_only", type: "edit_delete" })
})

it("writes remote conflict copy when local deleted and remote edited", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-delete-edit-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "base\n", 1)
  await writeDriveState(root, state)
  const remote = entry("notes.md", "remote\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_2", "remote\n")
  const result = await runDriveSyncOnce(root, api)
  await expect(readFile(join(root, "notes.md"), "utf8")).rejects.toThrow()
  expect(result.conflict_paths[0]).toContain("remote-conflict")
  expect((await readDriveState(root)).conflicts["notes.md"]).toMatchObject({ type: "delete_edit" })
})

it("does not overwrite local file when it changes during merge", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-race-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "a\nb\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "a\nlocal\nb\n")
  const remote = entry("notes.md", "a\nremote\nb\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "a\nb\n")
  api.downloads.set("notes.md@ver_2", "a\nremote\nb\n")
  scannerControl.afterHash = async (path) => {
    if (path.endsWith("notes.md")) {
      scannerControl.afterHash = undefined
      await writeFile(join(root, "notes.md"), "changed during merge\n")
    }
  }
  const result = await runDriveSyncOnce(root, api)
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("changed during merge\n")
  expect(result.conflicts).toBe(1)
})

it("records conflict instead of retrying when merged upload receives VERSION_CONFLICT", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-merge-upload-conflict-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "a\nb\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "a\nlocal\nb\n")
  const remote = entry("notes.md", "a\nremote\nb\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "a\nb\n")
  api.downloads.set("notes.md@ver_2", "a\nremote\nb\n")
  api.uploadFile = vi.fn(async () => {
    const error = new Error("HTTP 409: VERSION_CONFLICT") as Error & { code: string }
    error.code = "VERSION_CONFLICT"
    throw error
  })
  const result = await runDriveSyncOnce(root, api)
  expect(api.uploadFile).toHaveBeenCalledTimes(1)
  expect(result.conflicts).toBe(1)
})
```

Keep the test bodies explicit by copying the existing `stateEntry()`, `entry()`, `mkApi()` setup style from nearby tests.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts -t "conflict|merge|deleted|VERSION_CONFLICT"
```

Expected: new tests FAIL before implementation.

- [ ] **Step 3: Implement fallback policies**

In `processPath()` conflict branch:
- Route `local_and_remote_without_base` and `local_and_remote_changed` through conflict resolver.
- Route `local_changed_remote_deleted` to a record-only conflict with `type: "edit_delete"` and `strategy: "record_only"`.
- Route `remote_changed_before_delete` to a remote conflict copy with `type: "delete_edit"` and preserve local absence.
- If base version id is missing or versioned download fails, create remote conflict copy instead of clean merge.
- If local hash changes before merged write, do not write merged content; record conflict.
- If merged upload throws `VERSION_CONFLICT`, record conflict and do not loop.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/handwritten/commands/drive/sync.ts test/handwritten/drive/sync.test.ts
git commit -m "feat(drive): handle non-cleanable conflicts"
```

### Task 7: CLI Output, Watch Coverage, And Full Verification

**Files:**
- Modify: `test/handwritten/drive/sync.test.ts`
- Modify: `test/handwritten/drive/watch.test.ts`
- Modify: implementation files only if these tests expose a gap

- [ ] **Step 1: Add output and watch summary tests**

Add sync command test:

```ts
it("sets a non-zero exit code when conflict copies are produced", async () => {
  const root = await mkdtemp(join(tmpdir(), "wspc-drive-sync-command-conflict-"))
  const state = await initDriveState(root, "lib_1")
  state.entries["notes.md"] = stateEntry("notes.md", "old\n", 1)
  await writeDriveState(root, state)
  await writeFile(join(root, "notes.md"), "local\n")
  const remote = entry("notes.md", "remote\n", 2)
  const api = mkApi([{ entries: [remote] }])
  api.downloads.set("notes.md@ver_1", "old\n")
  api.downloads.set("notes.md@ver_2", "remote\n")
  const cmd = driveSyncCommand(api)
  await cmd.parseAsync(["node", "once", root])
  expect(render).toHaveBeenCalledWith({ kind: "drive_sync_once", display: { shape: "object" } }, expect.objectContaining({
    conflicts: 1,
    conflict_paths: expect.arrayContaining([expect.stringContaining("remote-conflict")]),
  }))
  expect(process.exitCode).toBe(1)
})
```

Add watch test that injects `runSync` returning `{ merged: 1, conflict_paths: ["notes.remote-conflict-...md"] }` and asserts watch emits the same summary event, without adding watch-specific conflict logic.

- [ ] **Step 2: Run focused tests and fix exposed gaps**

Run:

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/watch.test.ts
```

Expected: PASS after any small output-shape fixes.

- [ ] **Step 3: Run full verification**

Run sequentially:

```bash
npm run typecheck
npm run build
env -u NO_COLOR TERM=xterm-256color npm test
```

Expected: PASS. Do not run build and full tests in parallel because build cleans `dist/` while some tests execute `dist/cli.js`.

- [ ] **Step 4: Commit**

```bash
git add src/handwritten/commands/drive test/handwritten/drive package.json package-lock.json
git commit -m "test(drive): verify conflict merge output"
```

Skip this commit if Step 2 required no file changes.

## Self-Review

- Spec coverage: state metadata, versioned download, mergeable text policy, clean 3-way merge, remote conflict copy, delete/edit records, race guards, summary shape, watch reuse, and excluded non-goals all map to tasks above.
- Deliberate deferrals from spec: server-side merge, interactive prompt, Drive-specific JSON flag, UTF-16/Big5/Shift-JIS merge, rename detection, multi-round rebase, CRDT, ignore pattern, and conflict workspace stay out of scope.
- Placeholder scan: no deferred-fill markers, no future-only placeholders, and each task names exact files, commands, expected results, and implementation signatures.

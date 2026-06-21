# Drive remote manifest normalization refactor 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Drive sync 的 remote manifest validation、containment check、case-fold grouping 與 duplicate classification 抽到小型 helper，保留既有 sync 行為。

**Architecture:** `sync.ts` 保留 `getManifest()` pagination 與 summary mutation；新增 `manifest.ts` 只接收 root 與 manifest entries，回傳 normalized `remoteFiles` 與 `pathErrors`。這是 refactor，不改 decision table、state schema、summary shape 或 pagination。

**Tech Stack:** TypeScript、Vitest、現有 Drive `path-policy` 與 generated SDK 型別。

---

## File Structure

- Create: `src/handwritten/commands/drive/manifest.ts`，提供 `normalizeRemoteManifest(root, entries)`。
- Create: `test/handwritten/drive/manifest.test.ts`，直接測 helper boundary。
- Modify: `src/handwritten/commands/drive/sync.ts`，讓 `fetchRemoteManifest()` 只做 pagination、呼叫 helper、套用 `recordPathError()`。

## Task 1: Helper Tests

**Files:**
- Create: `test/handwritten/drive/manifest.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `test/handwritten/drive/manifest.test.ts`:

```ts
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeRemoteManifest } from "../../../src/handwritten/commands/drive/manifest.js"
import type { DriveManifestResponse } from "../../../src/generated/sdk/index.js"

type RemoteEntry = DriveManifestResponse["entries"][number]

function entry(path: string): RemoteEntry {
  return {
    id: `ent_${path.replace(/[^a-z0-9]/gi, "_")}`,
    path,
    kind: "file",
    entry_version: 1,
    current_version_id: "ver_1",
    content_sha256: "sha",
    size_bytes: 3,
    updated_at: "2026-06-21T00:00:00.000Z",
  }
}

describe("drive remote manifest normalization", () => {
  const root = resolve("/tmp/wspc-drive-root")

  it("keeps valid entries by exact path", () => {
    const a = entry("docs/a.txt")
    const b = entry("docs/b.txt")

    expect(normalizeRemoteManifest(root, [a, b])).toEqual({
      remoteFiles: { "docs/a.txt": a, "docs/b.txt": b },
      pathErrors: [],
    })
  })

  it("returns invalid paths as errors without accepting them", () => {
    const result = normalizeRemoteManifest(root, [
      entry("../escape.txt"),
      entry("/absolute.txt"),
      entry("bad\\\\slash.txt"),
    ])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual([
      "../escape.txt",
      "/absolute.txt",
      "bad\\\\slash.txt",
    ])
    expect(result.pathErrors.every((error) => error.error instanceof Error)).toBe(true)
  })

  it("reports case-only collisions for every ambiguous entry", () => {
    const result = normalizeRemoteManifest(root, [entry("A.txt"), entry("a.txt")])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual(["A.txt", "a.txt"])
    expect(result.pathErrors.map((error) => error.error.message)).toEqual([
      "REMOTE_PATH_CASE_CONFLICT: A.txt",
      "REMOTE_PATH_CASE_CONFLICT: a.txt",
    ])
    expect(result.pathErrors.every((error) => error.appendPathResult)).toBe(true)
  })

  it("reports exact duplicate paths for each duplicate entry", () => {
    const result = normalizeRemoteManifest(root, [entry("dup.txt"), entry("dup.txt")])

    expect(result.remoteFiles).toEqual({})
    expect(result.pathErrors.map((error) => error.path)).toEqual(["dup.txt", "dup.txt"])
    expect(result.pathErrors.map((error) => error.error.message)).toEqual([
      "REMOTE_PATH_DUPLICATE: dup.txt",
      "REMOTE_PATH_DUPLICATE: dup.txt",
    ])
    expect(result.pathErrors.every((error) => error.appendPathResult)).toBe(true)
  })
})
```

- [ ] **Step 2: Run RED**

```bash
npm test -- test/handwritten/drive/manifest.test.ts
```

Expected: fail because `src/handwritten/commands/drive/manifest.ts` does not exist.

## Task 2: Minimal Helper Implementation

**Files:**
- Create: `src/handwritten/commands/drive/manifest.ts`
- Test: `test/handwritten/drive/manifest.test.ts`

- [ ] **Step 1: Implement helper**

Create `src/handwritten/commands/drive/manifest.ts`:

```ts
import type { DriveManifestResponse } from "../../../generated/sdk/index.js"
import { resolveInsideRoot, validateDrivePath } from "./path-policy.js"

type RemoteManifestEntry = DriveManifestResponse["entries"][number]

export type RemoteManifestPathError = {
  path: string
  error: Error
  appendPathResult?: boolean
}

export type NormalizedRemoteManifest = {
  remoteFiles: Record<string, RemoteManifestEntry>
  pathErrors: RemoteManifestPathError[]
}

export function normalizeRemoteManifest(
  root: string,
  entries: RemoteManifestEntry[],
): NormalizedRemoteManifest {
  const candidates: RemoteManifestEntry[] = []
  const remoteFiles: Record<string, RemoteManifestEntry> = {}
  const pathErrors: RemoteManifestPathError[] = []

  for (const entry of entries) {
    try {
      validateDrivePath(entry.path)
      resolveInsideRoot(root, entry.path)
      candidates.push(entry)
    } catch (error) {
      pathErrors.push({ path: entry.path, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  const byCaseFoldedPath = new Map<string, RemoteManifestEntry[]>()
  for (const entry of candidates) {
    const folded = entry.path.toLowerCase()
    const group = byCaseFoldedPath.get(folded) ?? []
    group.push(entry)
    byCaseFoldedPath.set(folded, group)
  }

  for (const group of byCaseFoldedPath.values()) {
    const exactPathCounts = new Map<string, number>()
    for (const entry of group) {
      exactPathCounts.set(entry.path, (exactPathCounts.get(entry.path) ?? 0) + 1)
    }

    if (group.length > 1) {
      const hasExactDuplicate = Array.from(exactPathCounts.values()).some((count) => count > 1)
      const reason = hasExactDuplicate ? "REMOTE_PATH_DUPLICATE" : "REMOTE_PATH_CASE_CONFLICT"
      for (const entry of group.sort((left, right) => left.path.localeCompare(right.path))) {
        pathErrors.push({
          path: entry.path,
          error: new Error(`${reason}: ${entry.path}`),
          appendPathResult: true,
        })
      }
      continue
    }

    const [entry] = group
    if (entry) remoteFiles[entry.path] = entry
  }

  return { remoteFiles, pathErrors }
}
```

- [ ] **Step 2: Run GREEN**

```bash
npm test -- test/handwritten/drive/manifest.test.ts
```

Expected: new helper tests pass.

- [ ] **Step 3: Commit helper**

```bash
git add src/handwritten/commands/drive/manifest.ts test/handwritten/drive/manifest.test.ts
git commit -m "test(drive): cover remote manifest normalization"
```

## Task 3: Wire Sync To Helper

**Files:**
- Modify: `src/handwritten/commands/drive/sync.ts`
- Test: `test/handwritten/drive/sync.test.ts`
- Test: `test/handwritten/drive/path-policy.test.ts`
- Test: `test/handwritten/drive/manifest.test.ts`

- [ ] **Step 1: Replace inline normalization**

In `src/handwritten/commands/drive/sync.ts`, import the helper:

```ts
import { normalizeRemoteManifest } from "./manifest.js"
```

Then change `fetchRemoteManifest()` so it gathers all entries and applies helper results:

```ts
async function fetchRemoteManifest(
  root: string,
  state: DriveState,
  api: DriveSyncApi,
  summary: DriveSyncSummary,
  blockedPaths: Set<string>,
): Promise<Record<string, RemoteEntry>> {
  const entries: RemoteEntry[] = []
  let cursor: string | undefined
  do {
    const page = await api.getManifest(state.library_id, cursor)
    entries.push(...page.entries)
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)

  const normalized = normalizeRemoteManifest(root, entries)
  for (const pathError of normalized.pathErrors) {
    await recordPathError(summary, blockedPaths, pathError.path, pathError.error, {
      appendPathResult: pathError.appendPathResult,
    })
  }
  return normalized.remoteFiles
}
```

Delete the now-unused `validateRemoteEntry()` function and remove `validateDrivePath` from the path-policy import if unused.

- [ ] **Step 2: Run focused verification**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/path-policy.test.ts test/handwritten/drive/manifest.test.ts
npm run typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Commit wiring**

```bash
git add src/handwritten/commands/drive/sync.ts
git commit -m "refactor(drive): extract remote manifest normalization"
```

## Task 4: Final Verification And PR

**Files:**
- Verify all changed files.

- [ ] **Step 1: Rebase**

```bash
git fetch origin main
git rebase origin/main
```

Expected: clean rebase.

- [ ] **Step 2: Final checks**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/path-policy.test.ts test/handwritten/drive/manifest.test.ts
npm run typecheck
git diff --check origin/main..HEAD
env -u NO_COLOR FORCE_COLOR=1 npm test
```

Expected: focused tests pass, typecheck passes, diff check passes, full Vitest suite passes.

- [ ] **Step 3: Ponytail review**

Review only changed files for unnecessary complexity. Quick cuts should be fixed before PR; non-trivial follow-ups go into the todo comment.

- [ ] **Step 4: Draft PR and todo comment**

```bash
git push -u origin codex/refactor-drive-remote-manifest
gh pr create --draft --base main --head codex/refactor-drive-remote-manifest --title "Refactor Drive remote manifest normalization" --body-file /tmp/drive-remote-manifest-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVNAS67KDKN6KAZ3FXC4453Y "<summary>"
```

Expected: draft PR includes Todo ID, spec path, plan path, verification commands, and no local e2e smoke claim.

## Self-Review

Spec coverage: helper owns remote path validation、containment check、case-fold grouping 與 duplicate classification；`sync.ts` keeps pagination and summary mutation only.

Placeholder scan: no deferred work or vague edge-case instruction remains.

Type consistency: `RemoteManifestEntry` derives from `DriveManifestResponse["entries"][number]` in both helper and tests.

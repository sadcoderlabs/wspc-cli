# Drive Local Mutation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Drive sync 的本機檔案 mutation 細節從 `sync.ts` 搬到聚焦的 `local-mutations.ts`，保留既有行為與錯誤語意。

**Architecture:** `sync.ts` 保留 sync orchestration、manifest、action dispatch、conflict state 與 summary 更新；新增的 `local-mutations.ts` 擁有 download install、merge install/restore、delete local、backup/no-overwrite/existence guard 與 stable upload body。新模組只匯出 `sync.ts` 實際需要的高階 helper 與少量 shared guard，低階 backup/temp/hard-link helper 留為私有函式。

**Tech Stack:** TypeScript、Node `fs/promises`/streams、Vitest、現有 Drive scanner/path-policy/state 型別。

---

## File Structure

- Create: `src/handwritten/commands/drive/local-mutations.ts`，封裝本機 disk mutation helper，匯出 `readStableUploadBody()`、`assertLocalStillScanned()`、`assertLocalSafeForDownload()`、`assertLocalAbsentBeforeRemoteDelete()`、`downloadRemote()`、`writeMergedLocalFile()`、`removeLocalIfStillBase()`、`localFileExists()`、`installNoOverwrite()`。
- Modify: `src/handwritten/commands/drive/sync.ts`，刪除搬出的 helper 與不再需要的 Node imports，改從 `local-mutations.ts` import。
- Test: `test/handwritten/drive/sync.test.ts` 與 `test/handwritten/drive/merge.test.ts` 作為 refactor safety net。若搬動過程暴露 module boundary 缺口，只新增一個 focused test；目前先依靠既有 56 個 Drive 測試。

## Task 1: Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-06-21-drive-local-mutation-refactor-design.md`
- Read: `src/handwritten/commands/drive/sync.ts`
- Test: `test/handwritten/drive/sync.test.ts`
- Test: `test/handwritten/drive/merge.test.ts`

- [ ] **Step 1: Run focused baseline**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/merge.test.ts
```

Expected: `2 passed` test files and all Drive sync/merge tests pass before refactor.

- [ ] **Step 2: Confirm helper boundary**

Keep these helpers in the new module:

```ts
readStableUploadBody()
assertLocalStillScanned()
assertLocalSafeForDownload()
assertLocalAbsentBeforeRemoteDelete()
downloadRemote()
writeMergedLocalFile()
removeLocalIfStillBase()
localFileExists()
installNoOverwrite()
```

Keep these responsibilities in `sync.ts`: `runDriveSyncOnce()`, `fetchRemoteManifest()`, `processPath()`, `tryResolveConflict()` orchestration, conflict recording, state commit, summary updates.

- [ ] **Step 3: Commit plan**

```bash
git add docs/superpowers/plans/2026-06-21-drive-local-mutation-refactor.md
git commit -m "docs(drive): plan local mutation refactor"
```

## Task 2: Extract Local Mutation Module

**Files:**
- Create: `src/handwritten/commands/drive/local-mutations.ts`
- Modify: `src/handwritten/commands/drive/sync.ts`

- [ ] **Step 1: Create failing compile boundary**

Create `local-mutations.ts` with the target public surface and imports. Start from the existing helper bodies in `sync.ts`, preserving exact error strings:

```ts
export type MergedLocalInstall = {
  finalize: () => Promise<void>
  restore: () => Promise<void>
}

export async function readStableUploadBody(
  localPath: string,
  scanned: { sha256: string; size_bytes: number } | undefined,
): Promise<{ body: ArrayBuffer; digest: string }> {
  throw new Error("not implemented")
}
```

Then run:

```bash
npm run typecheck
```

Expected: FAIL until the full helper bodies and imports are moved.

- [ ] **Step 2: Move helper bodies without behavior edits**

Move the helper implementations from `sync.ts` to `local-mutations.ts`:

```ts
export async function downloadRemote(
  root: string,
  libraryId: string,
  path: string,
  api: { downloadFile(id: string, path: string, versionId?: string): Promise<Response> },
  expectedSha256: string | undefined,
  entry: DriveStateEntry | undefined,
  onLocalMutation: () => void,
): Promise<string>
```

Use the existing imports from `sync.ts`: `createWriteStream`, `link`, `mkdir`, `readFile`, `rename`, `rm`, `unlink`, `writeFile`, `basename`, `dirname`, `join`, `randomUUID`, `createHash`, `Readable`, `Transform`, `pipeline`, `NodeReadableStream`, `resolveInsideRoot`, `hashDriveFile`, and `DriveStateEntry`.

- [ ] **Step 3: Wire sync imports**

Replace local helper definitions in `sync.ts` with:

```ts
import {
  assertLocalAbsentBeforeRemoteDelete,
  assertLocalSafeForDownload,
  assertLocalStillScanned,
  downloadRemote,
  installNoOverwrite,
  localFileExists,
  readStableUploadBody,
  removeLocalIfStillBase,
  writeMergedLocalFile,
} from "./local-mutations.js"
```

Remove unused imports from `sync.ts`: `createWriteStream`, `link`, `rename`, `rm`, `unlink`, `Readable`, `Transform`, `pipeline`, and `NodeReadableStream` if they are no longer referenced there.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS. If TypeScript reports an unused import or inaccessible type, adjust only imports and exported helper signatures.

- [ ] **Step 5: Commit extraction**

```bash
git add src/handwritten/commands/drive/sync.ts src/handwritten/commands/drive/local-mutations.ts
git commit -m "refactor(drive): extract local file mutations"
```

## Task 3: Verify Behavior

**Files:**
- Test: `test/handwritten/drive/sync.test.ts`
- Test: `test/handwritten/drive/merge.test.ts`
- Verify: `src/handwritten/commands/drive/sync.ts`
- Verify: `src/handwritten/commands/drive/local-mutations.ts`

- [ ] **Step 1: Run focused Drive tests**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/merge.test.ts
```

Expected: all existing Drive sync and merge tests pass, including state write failure, merge install race, download hash mismatch, delete local race, and conflict copy reuse.

- [ ] **Step 2: Run required static checks**

```bash
npm run typecheck
git diff --check
```

Expected: both commands pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: full Vitest suite passes.

- [ ] **Step 4: Inspect diff for accidental behavior changes**

```bash
git diff origin/main -- src/handwritten/commands/drive/sync.ts src/handwritten/commands/drive/local-mutations.ts
```

Expected: the diff is mostly code movement and import cleanup. No decision-table, manifest-validation, state-schema, or summary-output behavior changes are present.

## Task 4: Publish Draft PR

**Files:**
- Update through git and GitHub only.

- [ ] **Step 1: Rebase on main**

```bash
git fetch origin main
git rebase origin/main
```

Expected: branch remains cleanly rebased on current `origin/main`.

- [ ] **Step 2: Final verification after rebase**

```bash
npm test -- test/handwritten/drive/sync.test.ts test/handwritten/drive/merge.test.ts
npm run typecheck
git diff --check
```

Expected: all pass after rebase.

- [ ] **Step 3: Push and open draft PR**

```bash
git push -u origin codex/refactor-drive-local-mutations
gh pr create --draft --base main --head codex/refactor-drive-local-mutations --title "Refactor Drive local file mutations" --body-file /tmp/drive-local-mutation-pr.md
```

Expected: GitHub returns a draft PR URL.

- [ ] **Step 4: Comment on WSPC todo**

```bash
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVNAS5117YNJAEAF1D2XWK8N --content "Implemented in draft PR: <PR URL>"
```

Expected: todo has a comment with PR URL and verification summary.

## Self-Review

Spec coverage: the plan extracts only local disk mutation helpers, leaves sync decision and manifest handling in place, preserves `onLocalMutation`, and verifies the specified Drive scenarios through existing tests.

Placeholder scan: no `TBD`, vague placeholder, or “similar to” task remains.

Type consistency: helper names and signatures match existing `sync.ts` call sites; `DriveStateEntry` remains the only state type needed by the new helper module.

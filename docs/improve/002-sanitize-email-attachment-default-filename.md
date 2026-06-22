# Plan 002: Sanitize default email attachment filenames

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's row in `docs/improve/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1bb2860..HEAD -- src/handwritten/commands/email/attachment.ts src/handwritten/utils/parse-content-disposition.ts test/handwritten/email-attachment.test.ts test/handwritten/parse-content-disposition.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1bb2860`, 2026-06-22
- **Todo**: `tod_01KVPNFZXNJ855MM4XZX3T72T3`

## Why this matters

When `wspc email attachment` is run without `--output`, the CLI derives a filename from the server's `Content-Disposition` header and passes it directly to `createWriteStream()`. A defensive CLI should not let a response header choose a nested path or path traversal string. The lazy fix is to accept only a local basename for header-derived defaults; explicit `--output` keeps full path behavior because the user chose it.

## Current state

- `src/handwritten/commands/email/attachment.ts:35-46` chooses `opts.output`, then header filename, then fallback, and writes to that string.
- `src/handwritten/utils/parse-content-disposition.ts:7-16` extracts quoted or unquoted `filename=...` but does not sanitize path separators.
- Existing tests cover normal quoted/unquoted filenames and default header-derived output.

Relevant excerpt:

```ts
// src/handwritten/commands/email/attachment.ts:35
const filename =
  opts.output ??
  parseContentDispositionFilename(res.headers.get("content-disposition")) ??
  `${emailId}-${idx}.bin`

const sink = createWriteStream(filename)
```

Repo conventions to match:

- Keep helpers tiny and dependency-free.
- Use stdlib path utilities if needed; do not add a package.
- Validation errors in this command write to stderr and set `process.exitCode = 1`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps | `npm ci` | exit 0 |
| Focused tests | `npm test -- test/handwritten/parse-content-disposition.test.ts test/handwritten/email-attachment.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope**:

- `src/handwritten/utils/parse-content-disposition.ts`
- `src/handwritten/commands/email/attachment.ts`
- `test/handwritten/parse-content-disposition.test.ts`
- `test/handwritten/email-attachment.test.ts`

**Out of scope**:

- Do not change outbound email send attachments.
- Do not add RFC 5987 `filename*` support unless it is needed to keep tests passing.
- Do not change explicit `--output` behavior.
- Do not add dependencies.

## Git workflow

- Branch: `codex/fix-email-attachment-filename`
- Commit message example: `fix(email): sanitize attachment filenames`

## Steps

### Step 1: Add failing filename safety tests

Add tests that demonstrate unsafe header-derived names do not write outside the current directory:

- Quoted `filename="../escape.txt"` should not create `../escape.txt`.
- Quoted `filename="nested/file.txt"` and Windows-style `filename="nested\\file.txt"` should not create nested paths.
- A safe filename such as `invoice.pdf` should still work.

Choose one expected policy and make it explicit. Recommended minimal policy: `parseContentDispositionFilename()` returns the basename only when the basename is non-empty and differs safely; otherwise returns `undefined`, causing the existing `${emailId}-${idx}.bin` fallback.

**Verify**: `npm test -- test/handwritten/parse-content-disposition.test.ts test/handwritten/email-attachment.test.ts` fails before implementation.

### Step 2: Sanitize header-derived filename

Implement the smallest helper behavior in `parse-content-disposition.ts`:

- Extract the existing token as today.
- Reject empty names.
- Reject names containing `/` or `\`.
- Reject `"."` and `".."`.
- Return the clean token.

This is stricter than `basename()` and avoids silently turning a malicious path into a plausible file name. Keep `--output` untouched.

**Verify**: focused tests pass.

### Step 3: Check command behavior

Confirm `attachment.ts` still uses the parser result as a default only. If the parser returns `undefined`, the existing fallback `${emailId}-${idx}.bin` should be used.

**Verify**: `npm run typecheck && npm test -- test/handwritten/email-attachment.test.ts` passes.

## Test plan

- Parser unit tests for safe filename, slash, backslash, `..`, and missing header.
- Command integration test that changes into a temp dir, downloads with unsafe header filename, and asserts the fallback file is created inside the temp dir while parent/nested paths are not.

## Done criteria

- [ ] Unsafe header-derived filenames cannot create nested or parent paths.
- [ ] Explicit `--output` still accepts user-supplied paths.
- [ ] Focused tests, typecheck, and `git diff --check` pass.
- [ ] No new dependency.
- [ ] `docs/improve/README.md` status row updated.

## STOP conditions

- The server now emits RFC 5987 `filename*` and the product expects decoding in this same change.
- Existing CLI docs promise that header filenames may include directories.
- The safe behavior requires changing generated email commands.

## Maintenance notes

Reviewer should check that only response-header defaults are sanitized. User-provided `--output` is an explicit local filesystem choice and should not be narrowed by this plan.

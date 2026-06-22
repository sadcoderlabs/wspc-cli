# Plan 004: Refresh dev toolchain security advisories

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1bb2860..HEAD -- package.json package-lock.json vitest.config.ts tsup.config.ts openapi-ts.config.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P2
- **Effort**: S/M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `1bb2860`, 2026-06-22
- **Todo**: `tod_01KVPNG298DP0M09TB6F99RDHH`

## Why this matters

`npm audit --audit-level=high` currently reports high-risk advisories in the dev/build/test toolchain. The published CLI runtime dependencies are not the main exposure here, but CI, local dev, and release jobs run these tools. Keep this as a dependency refresh plan, not a runtime security rewrite.

## Current state

- `package.json:21-28` pins dev dependencies including `@hey-api/openapi-ts`, `tsup`, `typescript`, and `vitest`.
- `package-lock.json:1872-1884` locks `esbuild` at `0.27.7`.
- `package-lock.json:3180-3197` locks `vite` at `8.0.14`.
- `npm audit --audit-level=high` at plan time reported a high Vite advisory and related esbuild advisory, plus moderate `js-yaml` through `@hey-api/openapi-ts`.

Relevant excerpt:

```json
// package.json:30
"scripts": {
  "prepare": "tsx scripts/build-version.ts",
  "sync-spec": "tsx scripts/sync-spec.ts",
  "generate": "npm run generate:sdk && npm run generate:cli",
  "build": "tsup",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

Repo conventions to match:

- Use npm and keep `package-lock.json` committed.
- Do not use `--force` to dodge peer/version issues.
- Generated code should not change from dependency refresh unless the generator output intentionally changes and is reviewed.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install clean | `npm ci` | exit 0 |
| Audit baseline | `npm audit --audit-level=high` | currently fails before fix; exits 0 after fix or has only documented non-high/unreachable advisories |
| Update deps | `npm update vite vitest esbuild @hey-api/openapi-ts` | exit 0, package-lock updated |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |
| Codegen drift | `npm run generate && git diff --exit-code -- src/generated` | exit 0 or STOP if generator changed output |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope**:

- `package.json` if direct dev dependency ranges must change.
- `package-lock.json`.
- Config files only if a tool major/minor update requires a documented config adjustment.

**Out of scope**:

- Do not migrate package managers.
- Do not downgrade `@hey-api/openapi-ts` to avoid `js-yaml`; investigate a patched compatible version first.
- Do not change source behavior or generated output unless explicitly caused by the generator update and reviewed.
- Do not use `npm audit fix --force`.

## Git workflow

- Branch: `codex/chore-dev-toolchain-advisories`
- Commit message example: `chore(deps): refresh dev toolchain advisories`

## Steps

### Step 1: Reproduce advisory state

Run:

```bash
npm ci
npm audit --audit-level=high
```

Record high advisories and the package chain in the commit/PR summary. Do not paste secret or token data; audit output should only contain package metadata.

**Verify**: audit fails before fix with high advisory evidence, or exits 0 because advisories were fixed upstream; if it exits 0, skip to done criteria and mark this plan no-op.

### Step 2: Apply the smallest compatible updates

First try:

```bash
npm update vite vitest esbuild @hey-api/openapi-ts
```

If `package.json` pins prevent lockfile movement, adjust only the minimal direct dev dependency versions needed. Prefer patch/minor updates. Do not introduce new dependencies.

**Verify**: `npm audit --audit-level=high` exits 0, or remaining high advisory is unreachable and documented with evidence.

### Step 3: Verify generator and build behavior

Run:

```bash
npm run generate
git diff --exit-code -- src/generated
npm run typecheck
npm test
npm run build
```

If `src/generated` changes, stop unless the dependency update explicitly includes an OpenAPI generator behavior change that the maintainer wants in this same PR.

**Verify**: all commands pass with no generated drift.

## Test plan

This is dependency/tooling work, so tests are verification commands rather than new unit tests:

- `npm audit --audit-level=high`
- `npm run generate && git diff --exit-code -- src/generated`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Done criteria

- [ ] `npm audit --audit-level=high` exits 0, or any remaining high advisory is documented as unreachable with maintainer approval.
- [ ] `package-lock.json` reflects the minimal dependency update.
- [ ] No source files changed unless required by tool config compatibility.
- [ ] Typecheck, tests, build, generated drift check, and `git diff --check` pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Fix requires `npm audit fix --force`.
- `@hey-api/openapi-ts` update changes generated SDK/CLI output.
- Tool update requires Node version changes outside the existing `>=24` engine.
- A high advisory remains in a reachable release path and no patched compatible version exists.

## Maintenance notes

Keep advisory triage grounded in reachability. Vite/esbuild here are dev/build dependencies, so the expected fix is dependency hygiene, not runtime code changes.

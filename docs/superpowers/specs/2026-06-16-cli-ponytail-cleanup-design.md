# CLI Ponytail Cleanup Design

## Goal

Apply the low-risk parts of the ponytail audit without changing CLI behavior.

## Scope

- Remove the unused `rimraf` devDependency from `package.json` and the lockfile.
- Add one small test helper for duplicated stdout capture and ANSI stripping.
- Reuse a single casing helper path in `tools/cli-codegen` instead of keeping duplicate camel-case helpers.

## Out Of Scope

- Do not change `AuthInterceptor`.
- Do not change the renderer registry.
- Do not edit generated CLI or SDK output unless a lockfile/tooling command does it mechanically.
- Do not change consistency-bookmark behavior.

## Design

The cleanup stays in existing files and one new test helper file.

For tests, move the repeated `captureStdout` and `stripAnsi` helpers into a helper module under `test/helpers`. Update only the tests that already duplicate those helpers.

For codegen, keep the existing emitted output stable. Collapse duplicate case-conversion helpers by routing snake-case operation names through one local helper and keeping kebab conversion separate only where flag names need it.

For dependencies, remove `rimraf` because no script or source file uses it.

## Verification

- `npm test`
- `npm run typecheck`
- `git diff --check`

# CLI Consistency Bookmark Support Design

Todo: `tod_01KV5TADS6EFTR1KTR3DD8M837`

## Goal

Support `x-consistency-bookmark` for every WSPC API request made by the CLI.
The CLI should store the latest bookmark returned by any WSPC API response and
send it on the next WSPC API request for the same configured environment.

This is CLI-only work. Fixing upstream OpenAPI metadata is out of scope.

## Context

The live calendar OpenAPI docs currently expose `x-consistency-bookmark` only on
calendar endpoints, while the product contract is broader: every WSPC API
request/response participates in the bookmark flow. The local CLI spec may lag
that contract, so generated command metadata is not the right source of truth
for this feature.

The CLI already routes most authenticated generated commands through
`loadSdkClient()`, and binary/direct authenticated fetches through
`loadAuthedFetch()`. Login/bootstrap code still performs direct fetches for
client registration, device flow, token polling, and `/auth/me`, so those paths
must be covered explicitly.

## Decisions

- Store the bookmark at the env level, not the account level.
- Apply the bookmark to every WSPC API HTTP call made by the CLI, including
  login/bootstrap and OAuth refresh calls.
- Save a response bookmark whenever the response includes
  `x-consistency-bookmark`.
- If the API returns `INVALID_CONSISTENCY_BOOKMARK`, clear the stored bookmark
  and surface the original error. Do not retry the request.
- Do not add user-visible bookmark flags or reset commands.
- Do not add cross-process locking.

## Architecture

Add a small handwritten helper around fetch, for example
`createConsistencyFetch(store, envName, apiBase, fetchImpl)`.

The helper:

1. Reads the current env config.
2. If `env.consistency_bookmark` exists and the request URL is under
   `env.api_base`, sets `x-consistency-bookmark` unless the caller already set
   that header.
3. Performs the request using the supplied fetch implementation.
4. If the response includes `x-consistency-bookmark`, writes it back to
   `env.consistency_bookmark`.
5. If the response body is an API error with
   `error.code === "INVALID_CONSISTENCY_BOOKMARK"`, clears
   `env.consistency_bookmark` and returns the same error response without
   retrying.

`EnvConfig` should gain an optional field:

```ts
consistency_bookmark?: string
```

`normalize()` must tolerate missing bookmarks so existing configs continue to
load unchanged.

## Integration Points

- `loadSdkClient()` should wrap the fetch passed into the generated SDK client.
  This covers generated commands and handwritten commands that call SDK
  operations.
- `loadAuthedFetch()` should return the same consistency-aware fetch. This
  covers direct authenticated fetches like attachment downloads.
- OAuth refresh inside `createAuthInterceptor()` should use the same wrapped
  fetch path so refresh requests also send and receive bookmarks.
- Login/bootstrap helpers (`client-registration`, `device-flow`, `fetch-me`)
  should use the helper with env scope. Because there may be no active account
  yet, env-level storage is required.

## Error Handling

On `INVALID_CONSISTENCY_BOOKMARK`, the helper clears the env bookmark and lets
the original response continue through the existing command error path. It does
not retry because some API requests are side-effecting and replaying them could
duplicate work.

If reading or writing the config fails, keep the existing CLI behavior: surface
the file/config error rather than silently ignoring it. Losing bookmark state is
less dangerous than hiding config corruption.

## Concurrency

Use the existing `ConfigStore.read()` / `write()` behavior. Concurrent CLI
processes may race and last writer wins.

// ponytail: no file lock; add an atomic update/lock only if concurrent CLI use
// causes real bookmark loss or config corruption.

## Tests

- Config normalization accepts configs without `consistency_bookmark`.
- The consistency fetch sends a stored env bookmark on a WSPC API request.
- The consistency fetch persists a returned `x-consistency-bookmark`.
- The consistency fetch does not send the header to non-WSPC URLs.
- The consistency fetch clears the env bookmark on
  `INVALID_CONSISTENCY_BOOKMARK` and does not retry.
- A `loadSdkClient()` test proves generated SDK requests use the wrapper.
- A login/bootstrap test proves direct auth fetches can use the wrapper.

## Out Of Scope

- Updating upstream OpenAPI to declare the header on every operation.
- Generated SDK or generated command changes solely for bookmark metadata.
- User-visible reset or override flags.
- Per-account bookmark state.
- Cross-process locking.

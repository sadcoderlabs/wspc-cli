# CLI Service Consistency Bookmarks

## Goal

Replace the CLI's single `x-consistency-bookmark` support with per-service
Cloudflare D1 consistency bookmark headers:

- auth: `x-cb-auth`
- todo: `x-cb-todo`
- calendar: `x-cb-cal`
- email: `x-cb-email`
- push: `x-cb-push`

Each service has its own D1 database, so bookmarks must not be shared across
services.

## Source Of Truth

The live API contract is `https://api.wspc.ai/openapi.json`. Implementation must
run `npm run sync-spec` and `npm run generate`, then commit the updated
`spec/openapi.json` and generated output.

## Config

Store bookmarks under each env:

```ts
consistency_bookmarks?: {
  auth?: string
  todo?: string
  calendar?: string
  email?: string
  push?: string
}
```

When normalizing config, discard the old `consistency_bookmark` field instead of
migrating it. The old value cannot be safely assigned to one service because it
may have come from any database.

Only string values are preserved in `consistency_bookmarks`.

## Request Handling

Keep the existing shared consistency fetch wrapper. It should choose the service
with a small path-prefix table:

| Path prefix | Service | Header |
| --- | --- | --- |
| `/auth` | `auth` | `x-cb-auth` |
| `/todo` | `todo` | `x-cb-todo` |
| `/calendar` | `calendar` | `x-cb-cal` |
| `/email` | `email` | `x-cb-email` |
| `/push` | `push` | `x-cb-push` |

The wrapper only injects a bookmark when the request URL is under the configured
`apiBase` and the path matches a known service. It injects only that service's
header, and only when the caller has not already provided the same header.

Unknown paths do not receive any bookmark header.

Known `x-cb-*` headers must not leak to URLs outside `apiBase`.

## Response Handling

For requests under `apiBase`, the wrapper reads all known `x-cb-*` response
headers. Any present value is persisted to the matching
`env.consistency_bookmarks[service]`.

This also applies when the request path is unknown, because the response header
itself identifies the service.

If the response body reports `INVALID_CONSISTENCY_BOOKMARK` and the wrapper
injected a service bookmark on the request, it deletes only that service's
stored bookmark. It must not retry the request; the original error response
continues to surface.

## Coverage

The shared wrapper remains the single integration point for generated SDK calls,
`loadAuthedFetch`, login bootstrap calls, OAuth device flow, client
registration, and token refresh.

## Tests

- Config normalization drops old `consistency_bookmark`.
- Config normalization preserves only string values in `consistency_bookmarks`.
- Each known path prefix injects only its matching `x-cb-*` header.
- Unknown paths inject no bookmark but still persist known response headers.
- Non-`apiBase` requests receive no known `x-cb-*` headers.
- Caller-provided matching service header is preserved.
- `INVALID_CONSISTENCY_BOOKMARK` clears only the injected service bookmark and
  does not retry.
- Existing `loadSdkClient`, `loadAuthedFetch`, login bootstrap, device flow, and
  client registration coverage is updated from `x-consistency-bookmark` to
  service bookmarks.

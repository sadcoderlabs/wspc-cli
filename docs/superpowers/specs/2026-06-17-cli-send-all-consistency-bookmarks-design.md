# CLI Send All Consistency Bookmarks Design

## Goal

Send every saved WSPC consistency bookmark on each WSPC API request so server-side cross-service calls can use the freshest known bookmarks.

## Context

PR #26 split the old `x-consistency-bookmark` header into service-specific headers:

- `auth`: `x-cb-auth`
- `todo`: `x-cb-todo`
- `calendar`: `x-cb-cal`
- `email`: `x-cb-email`
- `push`: `x-cb-push`

The current CLI chooses one header from the request path. That misses cross-service backend calls, such as a calendar endpoint calling auth internally.

## Design

For requests under the configured `apiBase`, the consistency fetch wrapper sends all saved service bookmarks from the active env config.

Before injection, it removes any caller-provided `x-cb-*` headers. The config remains the source of truth for outgoing bookmarks.

For requests outside `apiBase`, the wrapper keeps stripping all known `x-cb-*` headers and sends none. Bookmarks must not leak to non-WSPC origins or sibling API-base paths.

Response handling stays the same: persist every returned `x-cb-*` header to the matching saved service bookmark.

## Invalid Bookmark Handling

If the response body has `error.code === "INVALID_CONSISTENCY_BOOKMARK"` and this request injected one or more bookmarks, clear every service bookmark injected on that request.

The CLI does not retry. It returns the original response so the user sees the server error.

If the request injected no bookmarks, do not parse the body for invalid-bookmark cleanup.

## Tests

Update `test/consistency-fetch.test.ts` to cover:

- a WSPC API request injects all saved service bookmarks, regardless of path service;
- caller-supplied `x-cb-*` headers are replaced by saved config values for WSPC API requests;
- unknown API paths under `apiBase` also receive all saved bookmarks;
- non-`apiBase` requests still strip all known bookmark headers;
- `INVALID_CONSISTENCY_BOOKMARK` clears every bookmark injected on that request;
- requests with no injected bookmarks still avoid invalid-bookmark body parsing.

## Out Of Scope

- No API contract changes.
- No retry behavior.
- No generated SDK changes unless typecheck requires a mechanical update.
- No changes to config storage shape.

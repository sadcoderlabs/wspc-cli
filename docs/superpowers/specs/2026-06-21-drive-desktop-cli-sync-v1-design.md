# Drive Desktop CLI Sync v1 Design

## Goal

Add the first safe desktop Drive sync slice to `@wspc/cli`.

This slice binds a local folder to an existing WSPC Drive library and runs a manual one-shot whole-file sync. It does not create libraries, run a watcher, auto-merge conflicts, preserve empty directories, keep an operation queue, or detect renames.

## Commands

### `wspc drive bind`

```bash
wspc drive bind --library <library_id> [path]
```

`bind` connects a local folder to an existing remote Drive library. The name is intentional: it does not create the server library.

Behavior:

- Resolve `path` or the current working directory as the sync root.
- Call the generated `drive_library_get` operation before writing local state.
- If auth, permission, or library lookup fails, exit non-zero and write nothing.
- Create `.wspc-drive/state.json` with schema version, library id, timestamps, empty `entries`, and empty `conflicts`.
- Refuse to overwrite an existing state file bound to a different library.
- If the folder is already bound to the same library, print the current binding and exit successfully.
- Use the existing global output behavior; `--json` should produce a machine-readable binding result.

### `wspc drive sync once`

```bash
wspc drive sync once [path]
```

`sync once` performs one full folder scan and one full remote manifest comparison.

Behavior:

- Read `.wspc-drive/state.json` from `path` or the current working directory.
- Take `.wspc-drive/sync.lock` with exclusive create.
- Scan local regular files, excluding `.wspc-drive/`.
- Fetch the full remote manifest, following cursors until complete.
- Decide upload, download, delete, state-only update, state removal, conflict, or local error for each path.
- Persist state atomically after each successful path.
- Exit non-zero if any path fails or any conflict remains unresolved.

## API Boundary

Run `npm run generate` after the synced OpenAPI update so Drive JSON operations and generated command stubs exist.

Use generated SDK operations for JSON requests:

- `drive_library_get` for `drive bind` validation.
- `drive_manifest_get` for remote manifest reads.
- `drive_file_delete` for conditional remote delete.

Use handwritten `loadAuthedFetch` calls for raw byte transfer:

- `PUT /drive/libraries/{id}/files/content?path=...&expected_entry_version=...`
- `GET /drive/libraries/{id}/files/content?path=...`

This matches the existing email attachment download pattern, where streaming payloads stay handwritten and JSON operations stay generated.

## Local State

State lives at:

```text
.wspc-drive/state.json
```

Schema:

```json
{
  "schema_version": 1,
  "library_id": "lib_...",
  "created_at": "2026-06-21T00:00:00.000Z",
  "updated_at": "2026-06-21T00:00:00.000Z",
  "entries": {},
  "conflicts": {}
}
```

State stores only library binding and sync metadata. It never stores access tokens, refresh tokens, or API keys.

Each `entries[path]` records the last known safe base for that path:

- `entry_id`
- `entry_version`
- `current_version_id`
- `content_sha256`
- `size_bytes`
- `last_local_sha256`
- `last_synced_at`
- `status`

Each `conflicts[path]` records a conservative stop marker:

- `detected_at`
- `reason`
- `remote_entry_version`
- `remote_version_id`

State writes use a temp file in `.wspc-drive/`, flush, then rename to `state.json`. Reads ignore temp files.

The sync lock is `.wspc-drive/sync.lock`. v1 fails if the lock already exists and does not implement stale-lock recovery.

## Path Policy

Sync paths are normalized POSIX relative paths.

Reject:

- absolute paths
- `..`
- empty segments
- NUL or control characters
- Windows drive prefixes
- UNC paths
- backslashes
- UTF-8 paths over 1024 bytes
- UTF-8 segments over 255 bytes

Always exclude `.wspc-drive/`.

Include dotfiles and hidden files. Skip symlinks and non-regular files. Do not preserve empty directories.

If local scan finds two paths that differ only by case, mark `LOCAL_PATH_CASE_CONFLICT` and do not sync either path. If the remote manifest contains two paths that the local filesystem cannot represent distinctly, mark `REMOTE_PATH_CASE_CONFLICT` and do not download either path.

## Sync Algorithm

Each `sync once` performs a full scan.

1. Read local state.
2. Scan local files into `{ path, sha256, size_bytes }`.
3. Fetch the complete remote manifest.
4. Build `union(local paths, remote paths, state paths)` and process paths in sorted order.
5. For each path, choose exactly one action.
6. After every successful path-level local or remote mutation, atomically persist state.

Decision table:

| Base state | Local | Remote | Action |
| --- | --- | --- | --- |
| none | exists | none | upload create with `expected_entry_version=0` |
| none | none | exists | download remote |
| none | exists | exists, same hash | create state only |
| none | exists | exists, different hash | conflict |
| exists, local unchanged | none | remote unchanged | delete remote |
| exists, local unchanged | exists | remote changed | download remote |
| exists, local deleted | none | remote unchanged | delete remote |
| exists, local deleted | none | remote changed | conflict |
| exists, local changed | exists | remote unchanged | upload update with state `entry_version` |
| exists, local changed | exists | remote changed | conflict |
| exists | none | none | remove state entry |

Renames are old-path delete plus new-path create.

Downloads may overwrite a local file only when the current local hash matches `last_local_sha256`. Upload updates must use the last successful state `entry_version`, not a newer manifest version discovered during the same failing comparison.

If upload or delete returns `VERSION_CONFLICT`, record a conflict and leave the local file and existing base entry untouched.

## Error Handling And Output

`drive bind` exits non-zero and writes no state when login, auth, permission, or library lookup fails.

`drive sync once` exits non-zero for:

- missing `.wspc-drive/state.json`
- lock already exists
- invalid local or remote path
- case-only path collision
- network, auth, rate-limit, or server failure
- `VERSION_CONFLICT`
- unresolved conflict

Successful path changes are not rolled back. Failed paths keep their previous state, and completed paths remain persisted.

Human output should be a compact summary: uploaded, downloaded, deleted, unchanged, conflicts, errors. JSON output should include the same summary plus per-path results. Logs must not include file contents, tokens, auth headers, or full raw response bodies.

## Tests

Minimum test coverage:

- Command tests for `drive bind` successful validation/write, mismatched existing binding refusal, and validation failure without writes.
- State tests for atomic write, temp files ignored, schema guard, and existing lock.
- Path/scanner tests for unsafe path rejection, symlink and non-regular skip, dotfile include, `.wspc-drive/` exclude, and case collision detection.
- One table-driven decision test covering every sync table row.
- API-boundary tests proving generated JSON calls are used for library validation, manifest, and delete, while direct fetch is used for upload and download.
- Conflict tests proving `VERSION_CONFLICT` records a conflict without mutating the base state.
- Disk-write tests for download temp-then-rename and remote path containment inside the sync root.

## Out Of Scope

- `wspc drive init`
- `wspc drive watch`
- library creation commands
- ignore rules
- operation queue
- automatic text merge
- binary conflict copies
- rename detection
- stale-lock recovery
- empty directory preservation


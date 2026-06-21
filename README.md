# wspc

Official TypeScript SDK and CLI for [wspc.ai](https://wspc.ai).

> Status: **v0 walking skeleton.** Covers todo commands plus the first manual Drive sync slice.

## Install

```bash
npm i -g @wspc/cli
```

This installs the `wspc` binary globally.

## Quick start

```bash
wspc login                                  # OAuth device flow
wspc todo project ls                        # find a project id
wspc todo add "Buy milk" --project prj_xxx  # create
wspc todo ls --project prj_xxx              # list
wspc todo show tod_xxx                      # detail view
wspc todo done tod_xxx                      # mark done
```

`--project` (`-p`) is required on every list / create because the wspc API
scopes todos per project. Run `wspc todo project ls` to discover ids.

## Commands

| Command | Notes |
| --- | --- |
| `wspc login` | OAuth device-flow auth. Multiple accounts can be logged in at once per environment; `login` adds a new account without overwriting an existing one. |
| `wspc logout [email]` | Log out the active account, or a specific one by email. `--all` logs out every account in the current environment. |
| `wspc whoami` | Show the active account. |
| `wspc account ls` | List all logged-in accounts in the current environment; the active one is marked with ✓. |
| `wspc account switch <email>` | Set the active account for subsequent commands. |
| `wspc todo {add, ls, show, update, rm, done}` | Core todo CRUD. `done` is a sugar over `update --status done`. |
| `wspc todo project {add, ls}` | Project scope. |
| `wspc todo type ls` | List todo types. |
| `wspc todo rule ls` | List recurrence rules. |
| `wspc drive bind --library <id> [path]` | Bind an existing Drive library to a local folder. |
| `wspc drive sync once [path]` | Run one manual whole-file Drive sync pass. |
| `wspc config` | Inspect / clear local config. |

Pass `--help` to any subcommand for flags, aliases, and examples.

## Drive sync

Bind a local folder to an existing Drive library, then run sync explicitly:

```bash
wspc drive bind --library lib_xxx ./notes
wspc drive sync once ./notes
```

`bind` does not create a server library. It verifies the existing library, writes
`.wspc-drive/state.json`, and waits for an explicit `sync once`.

`sync once` is the v1 safe manual sync path: it performs a full folder scan,
compares local files with the remote manifest, uploads/downloads whole files,
uses optimistic remote versions for updates/deletes, and records conflicts in
local state instead of auto-merging them. It does not run a watcher, preserve
empty directories, detect renames, or create remote libraries.

### Running a command as a specific account

You can run any single command as a particular account without switching the active one:

```bash
wspc --account alice@example.com todo ls -p prj_xxx
WSPC_ACCOUNT=alice@example.com wspc todo ls -p prj_xxx
```

Precedence: `--account` flag > `WSPC_ACCOUNT` env var > active account (set by `wspc account switch`).

## Output: pretty by default, JSON for scripts

Commands print a coloured aligned table (lists) or key-value block (detail
views) when stdout is a terminal, and raw JSON when output is piped to a
file or another command:

```bash
wspc todo ls -p prj_xxx                 # pretty: table with status icons, relative due dates
wspc todo ls -p prj_xxx | jq '.todos'   # JSON: pipe-detected, no opt-in needed
wspc todo ls -p prj_xxx --json          # JSON: forced even in a terminal
```

Ids are rendered with the discriminating prefix bright and the rest dimmed —
they look short but **terminal text selection copies the full 30-character
id** so you can paste it straight into the next command. No truncation, no
404s.

The mode can also be forced via env:

| `WSPC_OUTPUT` value | Effect |
| --- | --- |
| `pretty` | Always render the table / key-value layout, even when piped. Useful in CI logs and screenshots. |
| `json` | Always emit JSON, even in a terminal. Same as `--json`. |
| _(unset)_ | TTY-detected. `--json` still wins. |

Colour follows the [`NO_COLOR`](https://no-color.org) and `FORCE_COLOR`
conventions on top of TTY detection.

## One-off invocations

If you'd rather not install globally, use `npx` — but two flags matter:

- **`-p @wspc/cli@latest`**: the package is `@wspc/cli` but the binary is `wspc`, so npx's default short form (`npx @wspc/cli ...`) can't resolve the bin on Windows. The `@latest` (or any explicit version) is also required — without it npx may dispatch flags like `--version` to itself.
- **`-y`**: skip the "install this?" prompt (optional but recommended for scripts).

```bash
npx -y -p @wspc/cli@latest wspc --version
npx -y -p @wspc/cli@latest wspc todo ls --project prj_xxx
```

See full docs at https://wspc.ai/docs (coming soon).

## License

MIT

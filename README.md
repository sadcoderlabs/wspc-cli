# wspc

Official TypeScript SDK and CLI for [wspc.ai](https://wspc.ai).

> Status: **v0 walking skeleton.** Covers the todo domain only.

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
| `wspc login` / `logout` / `whoami` | OAuth device-flow auth; tokens stored under your OS credential store. |
| `wspc todo {add, ls, show, update, rm, done}` | Core todo CRUD. `done` is a sugar over `update --status done`. |
| `wspc todo project {add, ls}` | Project scope. |
| `wspc todo type ls` | List todo types. |
| `wspc todo rule ls` | List recurrence rules. |
| `wspc config` | Inspect / clear local config. |

Pass `--help` to any subcommand for flags, aliases, and examples.

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

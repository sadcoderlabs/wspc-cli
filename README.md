# wspc

Official TypeScript SDK and CLI for [wspc.ai](https://wspc.ai).

> Status: **v0 walking skeleton.** Covers todo commands plus the first Drive bind / sync / watch slice.

## Roadmap

- [所有 Calendar CLI mutation 使用 Exclusive End](docs/superpowers/specs/2026-08-14-calendar-cli-exclusive-end-design.md)

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
| `wspc event occurrences <id> --from <value> --to <value>` | Expand one recurring series in a bounded half-open window; supports cursor pagination and parse-only `--tz`. |
| `wspc event agenda --from <value> --to <value>` | Merge overlapping single events and recurring occurrences in a bounded view-zone agenda. |
| `wspc event occurrence set <series-id> <recurrence-id> --start <value> --end <value>` | 改期單次 occurrence，同時保留不可變的 recurrence identity。 |
| `wspc event occurrence cancel <series-id> <recurrence-id>` | 取消單次 occurrence，不取消整個 series。 |
| `wspc event occurrence restore <series-id> <recurrence-id>` | 移除單次 occurrence exception，重新繼承 series。 |
| `wspc drive bind --library <id> [path]` | Bind an existing Drive library to a local folder. |
| `wspc drive sync once [path]` | Run one manual whole-file Drive sync pass. |
| `wspc drive watch [path]` | Keep a bound Drive folder in foreground watch mode. |
| `wspc config` | Inspect / clear local config. |

Pass `--help` to any subcommand for flags, aliases, and examples.

## Drive export

匯出目前 Workspace 所有 active Library 的 current files：

```bash
wspc --account example@example.com drive export add
wspc --account example@example.com --json drive export show
wspc --account example@example.com drive export download exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F --output ./drive-export.tar
```

`add` 立即返回 job，不等待打包；已有 unfinished job 時返回該 job 並標示 `reused: true`。
若建立回應遺失，結果會標示未知，請先 `show` 查詢再決定是否重試。`show` 顯示帳號、
Workspace、job 狀態、已處理檔數、bytes、期限與錯誤；沒有工作為 `job: null`。
`download` 固定下載指定 ID，新工作不會取代該份 package。JSON 時間維持 Unix ms。

Package 是未壓縮 tar，不含 history／Trash，不占 Workspace Storage，配額已滿仍可匯出。
它不是時間點 snapshot：每批讀取當時的 current version，並行修改可能使檔數與建立時不同。
需要穩定副本時先停止寫入，再建立新 job。來源缺失會讓新 job 失敗，不提供部分 package；
部署前的舊包無法回溯保證完整性，應重新匯出。每份 package 自完成起保留七天。

輸出父目錄必須存在，filesystem 必須支援同目錄 hard link。下載使用私有暫存檔並在完整
接收後發布；既有檔案、symlink 或下載途中新增的目標都不會被覆蓋，沒有 overwrite／copy
fallback。失敗時不輸出成功物件；若暫存檔無法清理，stderr 會列出殘留路徑。舊 server
缺少身分／長度 headers 時會要求相容版本，不改用 latest 下載。

開發時可執行 `npm run build && node scripts/check-drive-export-streaming.mjs`，用實際 CLI
子程序下載 128／512 MiB tar，各跑三次並驗證 OS peak RSS、獨立 tar/hash 與 no-clobber。
需要 Python 3；macOS／Linux 另驗 SIGINT／SIGTERM 清理，三平台由 GitHub Actions 驗證。

## Drive sync

把本機資料夾綁到既有 Drive library，然後先用一次性 sync 驗證狀態：

```bash
wspc drive bind --library lib_xxx ./notes
wspc drive sync once ./notes
```

`bind` 不會建立 server library。它只會驗證既有 library、寫入
`.wspc-drive/state.json`，然後等待明確的 `sync once` 或 `watch`。

`sync once` 是安全的一次性 sync path：它會完整掃描資料夾、比對 remote
manifest、上傳 / 下載 whole files、用 optimistic remote versions 做 update /
delete，並把 conflicts 記在本機 state，而不是自動 merge。它不會啟動 watcher、
保留空目錄、偵測 rename，或建立 remote libraries。

需要 foreground 監看時使用：

```bash
wspc drive watch ./notes
```

`watch` 會共用同一個 `sync once` correctness boundary。本機檔案事件與 Drive
realtime WebSocket event 都只是 sync hint：CLI 收到 event 後排程完整 sync pass，
不會直接依 realtime payload 改檔案或宣稱檔案已同步。realtime connection 會沿用
既有 CLI auth，token 只留在 memory，不寫入 `.wspc-drive/state.json` 或 output。

watch output 會顯示 `drive_watch_started`、`drive_sync_once`、
`drive_realtime_connected`、`drive_realtime_event`、
`drive_realtime_reconnecting`、`drive_realtime_warning` 或
`drive_realtime_auth_failed`。在 `--json` / pipe 模式下，這些 event 會以
newline-delimited JSON objects 輸出，方便 scripts 追蹤 foreground watch 狀態。

socket 被拒（`401`、`403`、close code `4401`、server 送的 auth error frame）不會
停止 realtime。watch 會照 backoff 一直重連，並送出帶 `reason: "auth"` 的
`drive_realtime_reconnecting`；每次重連都重新解析 credentials，所以過期的 access
token 會在這一步 rotate。只有 server 拒絕 rotate refresh token 時才會送出
`drive_realtime_auth_failed`，它固定帶 `recoverable: false`，並在 server 有給的時候
帶 `reason`（`refresh_token_reused` 等原始 `error_description`）。

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

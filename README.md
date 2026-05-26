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
wspc login
wspc todo add "Buy milk"
wspc todo ls
```

### One-off invocations

If you'd rather not install globally, use `npx` — but two flags matter:

- **`-p @wspc/cli@latest`**: the package is `@wspc/cli` but the binary is `wspc`, so npx's default short form (`npx @wspc/cli ...`) can't resolve the bin on Windows. The `@latest` (or any explicit version) is also required — without it npx may dispatch flags like `--version` to itself.
- **`-y`**: skip the "install this?" prompt (optional but recommended for scripts).

```bash
npx -y -p @wspc/cli@latest wspc --version
npx -y -p @wspc/cli@latest wspc todo ls
```

See full docs at https://wspc.ai/docs (coming soon).

## License

MIT

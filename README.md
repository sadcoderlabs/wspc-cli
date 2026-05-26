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

If you'd rather not install globally, use `npx` with the **`-p`** flag — the package is `@wspc/cli` but the binary is `wspc`, so npx's default short form (`npx @wspc/cli ...`) can't resolve the bin name on Windows:

```bash
npx -p @wspc/cli wspc --version
npx -p @wspc/cli wspc todo ls
```

See full docs at https://wspc.ai/docs (coming soon).

## License

MIT

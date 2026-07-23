# Issue tracker：WSPC todos

本 repo 的 issues 與 PRDs 儲存在 WSPC todos。所有操作使用 published `@wspc/cli`，不要改用 GitHub Issues。

## CLI

使用一次性 npm invocation，不需要 global install：

```bash
npx -y -p @wspc/cli@latest wspc <command>
```

不確定 command shape 或 flags 時，先查看對應 help：

```bash
npx -y -p @wspc/cli@latest wspc todo --help
npx -y -p @wspc/cli@latest wspc todo add --help
npx -y -p @wspc/cli@latest wspc todo update --help
```

## Project selection

1. 從 `origin` remote 的最後一個 path component 推導 repository name，移除 `.git`。
2. 若沒有 `origin`，使用 repository root directory name。
3. 執行：

   ```bash
   npx -y -p @wspc/cli@latest wspc --json todo project ls
   ```

4. 選擇 name 與 repository name 完全相同的唯一 project。
5. 若零個或多個 project 符合，停止寫入並回報 repository name 與候選 projects；不要猜測 project。

## Conventions

- 每個 issue 或 PRD 對應一個 WSPC todo。
- Todo ID（例如 `tod_...`）是 canonical issue reference。
- 建立、讀取、更新、comment、tag 與 status 操作都使用 `wspc todo` commands。
- List 與 search 必須遵循 pagination，直到 response 不再提供 `next_cursor`。
- Dedup 必須比較 code target 與 intended outcome；只有共用 tag、package 或關鍵字不足以判定 duplicate。
- Triage roles 使用 `docs/agents/triage-labels.md` 定義的 tag strings。
- 發布 spec 時，todo body 必須保留完整 Markdown sections。
- CLI 若回報未登入，執行錯誤訊息或 help 所提供的 login／device-flow command，完成驗證後再重試。
- 除非 workflow 明確要求，issue tracking 不使用 GitHub Issues。

## 當 skill 說「publish to the issue tracker」

在同名 WSPC project 建立一個 todo，並回報完整 todo ID。

## 當 skill 說「fetch the relevant ticket」

使用 `wspc todo show <todo-id>` 讀取 todo，並視需要取得 comments、tags 與目前 status。

# Drive stale sync lock recovery 實作計畫

> **給 agentic workers：** 必要 sub-skill：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤。

**目標：** 讓 Drive sync 在遇到很舊的 `.wspc-drive/sync.lock` 時能回收 lock 並繼續執行，同時保留 fresh lock 的互斥保護。

**架構：** 只改 `withDriveLock()` 的 lock acquisition：fresh lock 仍丟 `sync lock already exists`，stale lock 先刪除再重新用 exclusive create 取得。Docs/spec 更新原本的 v1 deferral，tests 用 `fs.utimes()` 產生 stale lock，不新增 lock service。

**技術棧：** TypeScript、Node fs promises、Vitest、Drive state helpers。

---

### 任務 1: Spec 與 tests

**檔案：**
- 修改：`docs/superpowers/specs/2026-06-21-drive-desktop-cli-sync-v1-design.md`
- 修改：`docs/superpowers/specs/2026-06-21-drive-sync-watch-design.md`
- 修改：`test/handwritten/drive/state.test.ts`

- [x] **步驟 1: 更新 spec 語意**

把「不實作 stale-lock recovery」改成目前支援「超過 10 分鐘的 lock 可回收；fresh lock 仍失敗」。

- [x] **步驟 2: 寫 RED tests**

在 `state.test.ts` 新增兩個 cases：fresh `sync.lock` 仍拒絕；old `sync.lock` 會被回收且 callback 執行。

- [x] **步驟 3: 驗證 RED**

執行：`npm test -- test/handwritten/drive/state.test.ts`
預期：old lock recovery case 在實作前失敗。

### 任務 2: 最小 stale lock recovery

**檔案：**
- 修改：`src/handwritten/commands/drive/state.ts`
- 修改：`docs/improve/README.md`

- [x] **步驟 1: 實作 stale recovery**

在 `withDriveLock()` 使用 `stat(lockFile)` 判斷 mtime，超過 `10 * 60 * 1000` 才 `rm(lockFile, { force: true })` 並重新 `open(lockFile, "wx")`。Fresh lock 的錯誤訊息保持 `sync lock already exists`。

- [x] **步驟 2: 驗證 focused tests**

執行：`npm test -- test/handwritten/drive/state.test.ts test/handwritten/drive/watch.test.ts`
預期：全部通過，watch fresh lock fatal 語意不變。

- [x] **步驟 3: 標記 improve plan 完成**

把 `docs/improve/README.md` 內 plan 005 的狀態從 `TODO` 改成 `DONE`。

- [ ] **步驟 4: 最終檢查**

執行：

```bash
npm run typecheck
env -u NO_COLOR FORCE_COLOR=1 npm test
git diff --check
```

預期：所有 commands 都以 0 結束。

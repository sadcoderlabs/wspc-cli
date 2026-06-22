# ConfigStore.update mutation routing 實作計畫

> **給 agentic workers：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 將 production config mutation 從 `read()` 加 `write()` 改為既有的 `ConfigStore.update()`，避免 stale snapshot 覆蓋 token refresh、consistency bookmark 或帳號切換。

**架構：** 不新增抽象；沿用 `ConfigStore.update()` 的 locked read-modify-write。先補一個 command mutation regression，再逐步改 command/auth 寫入點。

**技術：** TypeScript strict ESM、Vitest、既有 `ConfigStore`。

---

## 參考規格

完整規格與 STOP conditions 在 `docs/improve/001-use-configstore-update-for-config-mutations.md`。若本計畫和該檔衝突，以 `docs/improve` 檔案為準。

## 檔案結構

- 修改：`test/config-lock.test.ts`，新增 interleaved command mutation regression。
- 修改：`src/handwritten/commands/account.ts`，讓 `switchAccount()` 使用 `store.update()`。
- 修改：`src/handwritten/commands/config.ts`，讓 `setConfigKey()` 和 `config use` 使用 `store.update()`。
- 修改：`src/handwritten/commands/whoami.ts`，讓 `backfillActiveEmail()` 使用 `store.update()`。
- 修改：`src/handwritten/auth/logout.ts`，讓 logout mutations 使用 `store.update()`。
- 修改：`src/handwritten/auth/login.ts`，讓 API key 和 OAuth login 的 config writes 使用 `store.update()`。
- 修改：`src/handwritten/auth/client-registration.ts`，讓 client id bootstrap/persist 使用 `store.update()`。
- 修改：`docs/improve/README.md`，完成時把 plan 001 狀態更新成 `DONE`。

## Task 1：simple command mutations

**檔案：**
- 修改：`test/config-lock.test.ts`
- 修改：`src/handwritten/commands/account.ts`
- 修改：`src/handwritten/commands/config.ts`
- 修改：`src/handwritten/commands/whoami.ts`
- 修改：`src/handwritten/auth/logout.ts`

- [ ] **步驟 1：確認 baseline**

```bash
npm test -- test/config-lock.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts
```

預期：既有測試通過。

- [ ] **步驟 2：先新增 failing regression**

在 `test/config-lock.test.ts` 新增一個測試：用 `store.read()` 先拿 stale snapshot，同時用 `store.update()` 寫入 bookmark，再呼叫一個目前仍直接 `read()`/`write()` 的 helper，例如 `switchAccount(store, "b@x.com")`。測試應驗證 active account 變成 `b@x.com`，且 bookmark 沒被 stale snapshot 覆蓋。

建議測試形狀：

```ts
it("command mutations do not clobber interleaved bookmark updates", async () => {
  await store.update((cfg) => {
    cfg.envs.prod!.accounts["b@x.com"] = { email: "b@x.com" }
  })

  await Promise.all([
    switchAccount(store, "b@x.com"),
    store.update((cfg) => {
      cfg.envs.prod!.consistency_bookmarks ??= {}
      cfg.envs.prod!.consistency_bookmarks.todo = "B2"
    }),
  ])

  const c = await store.read()
  expect(c.envs.prod!.current_account).toBe("b@x.com")
  expect(c.envs.prod!.consistency_bookmarks?.todo).toBe("B2")
})
```

若這個 parallel timing 不穩，改用一個測試專用 delayed `ConfigStore` subclass 來延遲 `write()`；不要改 production `ConfigStore`。

- [ ] **步驟 3：確認 RED**

```bash
npm test -- test/config-lock.test.ts
```

預期：新增 regression 失敗，因為 command mutation 仍會用 direct write 覆蓋 interleaved update。

- [ ] **步驟 4：改 simple helpers**

將這些 mutation 改成 `store.update((c) => { ... })`：

- `switchAccount()`
- `setConfigKey()`
- `config use` action
- `backfillActiveEmail()`
- `runLogout()`

保留既有錯誤訊息與 return shape。需要回傳 `removed` / `newActive` 時，在 mutator 外宣告變數，mutator 裡賦值，`await update()` 後回傳。

- [ ] **步驟 5：確認 GREEN**

```bash
npm test -- test/config-lock.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts
```

預期：全部通過。

- [ ] **步驟 6：commit**

```bash
git add test/config-lock.test.ts src/handwritten/commands/account.ts src/handwritten/commands/config.ts src/handwritten/commands/whoami.ts src/handwritten/auth/logout.ts
git commit -m "fix(config): serialize command mutations"
```

## Task 2：auth mutations

**檔案：**
- 修改：`src/handwritten/auth/login.ts`
- 修改：`src/handwritten/auth/client-registration.ts`

- [ ] **步驟 1：更新 `ensureClientId()`**

保留 HTTP registration 在 lock 外。先用 `store.update()` 建 env；registration 完成後，再用 `store.update()` 只寫入 `client_id` 和必要 env fields。若第二次 update 時已有 `client_id`，保留既有 id 並回傳它，避免覆蓋並行註冊結果。

- [ ] **步驟 2：更新 `runLogin()` API key path**

把初始 env 建立與 final account merge 都改成 `store.update()`。`fetchMe()` 仍在 lock 外。保留 API key login 會刪 OAuth tokens 的行為。

- [ ] **步驟 3：更新 `runLogin()` OAuth path**

device flow、`fetchMe()` 都留在 lock 外。最後用 `store.update()` merge account，保留 OAuth login 會刪 stale `api_key` 的行為。

- [ ] **步驟 4：focused auth checks**

```bash
npm test -- test/login.test.ts test/client-registration.test.ts test/load-sdk-client.test.ts
```

預期：全部通過。

- [ ] **步驟 5：commit**

```bash
git add src/handwritten/auth/login.ts src/handwritten/auth/client-registration.ts
git commit -m "fix(auth): serialize login config writes"
```

## Task 3：sweep、文件狀態與 PR 前檢查

**檔案：**
- 修改：`docs/improve/README.md`

- [ ] **步驟 1：掃 direct writes**

```bash
rg -n "await .*\\.write\\(|store\\.write\\(" src/handwritten
```

預期：production direct config mutations 不再出現在 auth/command paths；`src/handwritten/config/index.ts` 低階 primitive 可保留。

- [ ] **步驟 2：更新 improve 狀態**

在 `docs/improve/README.md` 將 plan 001 狀態從 `TODO` 改成 `DONE`。

- [ ] **步驟 3：final focused checks**

```bash
npm test -- test/config-lock.test.ts test/login.test.ts test/logout-whoami.test.ts test/account-cmd.test.ts test/config-cmd.test.ts test/whoami-rekey.test.ts test/client-registration.test.ts
npm run typecheck
git diff --check
```

預期：全部通過。

- [ ] **步驟 4：full tests**

```bash
env -u NO_COLOR FORCE_COLOR=1 npm test
```

預期：完整 test suite 通過。

- [ ] **步驟 5：commit**

```bash
git add docs/improve/README.md
git commit -m "docs(improve): mark config mutation plan done"
```

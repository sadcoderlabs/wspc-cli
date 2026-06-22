# Drive realtime optional field builder 瘦身計畫

> **給 agentic workers：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 刪除 `realtime.ts` 裡一次性的 `optionalString()` generic helper，改用原地 object spread literal 表達 optional 欄位。

**架構：** 只修改 `src/handwritten/commands/drive/realtime.ts`。不改 realtime protocol、不改 `DriveRealtimeMessage` union、不改 WebSocket connector、不改 generated code，也不新增 helper。

**技術：** TypeScript、Vitest、Node 24 原生 `WebSocket`。

---

## 檔案結構

- 修改：`src/handwritten/commands/drive/realtime.ts`，刪除 `optionalString()`，把 call sites 改成 direct object spread literals。
- 不修改：`test/handwritten/drive/realtime.test.ts`，既有測試已覆蓋這次 refactor 的行為邊界。

## 任務 1：刪除 optionalString helper

**檔案：**
- 修改：`src/handwritten/commands/drive/realtime.ts`

- [ ] **步驟 1：確認 baseline**

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
npm run typecheck
```

預期：1 個 test file、20 個 tests 通過，typecheck 通過。

- [ ] **步驟 2：改 ready replay event payload**

把 `handleMessage()` 的 ready replay branch 從 helper call：

```ts
handlers?.onEvent(optionalString({ debounce_ms: 2000, reason: "ready_replay" }, "cursor", message.cursor))
```

改成原地 object literal：

```ts
handlers?.onEvent({
  debounce_ms: 2000,
  reason: "ready_replay",
  ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
})
```

- [ ] **步驟 3：改 library_changed event payload**

把 nested helper call：

```ts
handlers?.onEvent(optionalString(optionalString({
  debounce_ms: 2000,
  reason: "library_changed",
}, "cursor", message.cursor), "path", message.path))
```

改成：

```ts
handlers?.onEvent({
  debounce_ms: 2000,
  reason: "library_changed",
  ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
  ...(message.path === undefined ? {} : { path: message.path }),
})
```

- [ ] **步驟 4：改 resync_required event payload**

把：

```ts
handlers?.onEvent(optionalString({ immediate: true, reason }, "cursor", message.cursor))
```

改成：

```ts
handlers?.onEvent({
  immediate: true,
  reason,
  ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
})
```

- [ ] **步驟 5：改 parseDriveRealtimeMessage() 回傳 object**

把 `ready`、`library_changed`、`resync_required`、`error`、`unknown` branches 改成 direct spread literals，保留相同輸出 shape：

```ts
if (messageType === "ready") {
  return {
    type: "ready",
    replayed: typeof value.replayed === "number" ? value.replayed : 0,
    ...(cursor === undefined ? {} : { cursor }),
  }
}
if (messageType === "library_changed") {
  return {
    type: "library_changed",
    ...(cursor === undefined ? {} : { cursor }),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
  }
}
if (messageType === "resync_required") {
  return {
    type: "resync_required",
    ...(cursor === undefined ? {} : { cursor }),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  }
}
if (messageType === "error") {
  return {
    type: "error",
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.message === "string" ? { message: redactedRealtimeError(value.message) } : {}),
  }
}
return {
  type: "unknown",
  ...(messageType === undefined ? {} : { message_type: messageType }),
}
```

- [ ] **步驟 6：改 resyncRealtimeState() normal cursor branch**

把：

```ts
return optionalString({ ...realtime, last_event_at: lastEventAt }, "last_cursor", cursor)
```

改成：

```ts
return {
  ...realtime,
  last_event_at: lastEventAt,
  ...(cursor === undefined ? {} : { last_cursor: cursor }),
}
```

invalid cursor branch 保持現有 destructuring，因為它刻意移除 `last_cursor`。

- [ ] **步驟 7：刪除 helper 並檢查引用**

刪除整個 `optionalString()` function，然後執行：

```bash
rg "optionalString" src/handwritten/commands/drive/realtime.ts
```

預期：沒有輸出。

- [ ] **步驟 8：focused checks**

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
npm run typecheck
git diff --check
```

預期：全部通過。

- [ ] **步驟 9：commit**

```bash
git add src/handwritten/commands/drive/realtime.ts
git commit -m "refactor(drive): inline realtime optional fields"
```

## 任務 2：PR 前檢查

**檔案：**
- 驗證全部變更檔案。

- [ ] **步驟 1：rebase 到最新 main**

```bash
git fetch origin main
git rebase origin/main
```

預期：沒有 conflict。

- [ ] **步驟 2：最終 checks**

```bash
env -u NO_COLOR TERM=xterm-256color npm test -- test/handwritten/drive/realtime.test.ts
npm run typecheck
git diff --check origin/main..HEAD
rg "optionalString" src/handwritten/commands/drive/realtime.ts
env -u NO_COLOR FORCE_COLOR=1 npm test
```

預期：focused tests、typecheck、diff check、full suite 全部通過；`optionalString` 不再出現在 `realtime.ts`。

- [ ] **步驟 3：Ponytail review**

檢查 diff 是否還能再縮。這次不要新增 helper、factory 或 schema layer；若沒有新發現就進入 PR。

- [ ] **步驟 4：draft PR 與 todo comment**

```bash
git push -u origin codex/shrink-drive-realtime-optional-fields
gh pr create --draft --base main --head codex/shrink-drive-realtime-optional-fields --title "Shrink Drive realtime optional field builder" --body-file /tmp/drive-realtime-optional-fields-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVND96E2WP6EEBAQV2Q9ZR3Y "<summary>"
```

預期：draft PR body 包含 Todo ID、spec path、plan path、verification commands 與 e2e-smoke note。

## 自我檢查

Spec 覆蓋：本計畫只刪 `optionalString()`，並覆蓋 handleMessage payload、parseDriveRealtimeMessage branches、resyncRealtimeState normal cursor branch。

Placeholder 掃描：沒有 placeholder。

型別一致性：所有 object literal 欄位沿用既有 `DriveRealtimeMessage` 與 handler payload shape。

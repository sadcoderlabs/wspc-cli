# 內聯 email MIME helper 實作計畫

> **給 agentic workers：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐 task 執行本計畫。步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 刪除單一 caller 的 MIME utility file，將 outbound email attachment 的 MIME 對應留在 `email/send.ts` 私有範圍。

**架構：** 不新增 dependency、不新增 shared utility。把既有 MIME table 與 `mimeFromExt()` 移到 `src/handwritten/commands/email/send.ts`，刪掉 standalone utility 與 standalone test，並在 `email-send.test.ts` 保留 attachment content type 覆蓋。

**技術：** TypeScript、Commander、Vitest、Node `path.extname`。

---

## 檔案結構

- 修改：`src/handwritten/commands/email/send.ts`，移除 utility import，新增本地 `MIME_BY_EXT` 與私有 `mimeFromExt()`。
- 刪除：`src/handwritten/utils/mime-from-ext.ts`。
- 修改：`test/handwritten/email-send.test.ts`，補 unknown extension fallback 覆蓋。
- 刪除：`test/handwritten/mime-from-ext.test.ts`。

## 任務 1：內聯 MIME helper 並刪 standalone utility

**檔案：**
- 修改：`src/handwritten/commands/email/send.ts`
- 刪除：`src/handwritten/utils/mime-from-ext.ts`
- 修改：`test/handwritten/email-send.test.ts`
- 刪除：`test/handwritten/mime-from-ext.test.ts`

- [ ] **步驟 1：確認 baseline**

```bash
npm test -- test/handwritten/email-send.test.ts test/handwritten/mime-from-ext.test.ts
npm run typecheck
```

預期：2 個 test files 通過，typecheck 通過。

- [ ] **步驟 2：先補 unknown extension fallback 覆蓋**

在 `test/handwritten/email-send.test.ts` 的 local file attachment 測試後新增：

```ts
it("--attach unknown extension falls back to octet-stream", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wspc-test-"))
  const file = join(dir, "payload.weird")
  writeFileSync(file, "raw")
  await sendCommand.parseAsync([
    "node", "send",
    "--from", "a@d", "--to", "x@y", "--subject", "S", "--text", "T",
    "--idempotency-key", "k-unknown", "--attach", file,
  ])
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const body = sendMock.mock.calls[0]![0].body
  expect(body.attachments[0]).toMatchObject({
    filename: "payload.weird",
    content_type: "application/octet-stream",
    content_base64: Buffer.from("raw").toString("base64"),
  })
})
```

- [ ] **步驟 3：執行 email-send 測試**

```bash
npm test -- test/handwritten/email-send.test.ts
```

預期：測試通過。這個覆蓋取代 standalone utility fallback test。

- [ ] **步驟 4：在 email send command 內聯 MIME table**

在 `src/handwritten/commands/email/send.ts` 中把 path import 改成：

```ts
import { basename, extname } from "node:path"
```

刪除：

```ts
import { mimeFromExt } from "../../utils/mime-from-ext.js"
```

在 size constants 附近加入私有 table 與 helper：

```ts
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  ics: "text/calendar",
  zip: "application/zip",
}

function mimeFromExt(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}
```

不要 export helper，不要新增 dependency，也不要擴大 MIME table。

- [ ] **步驟 5：刪除 standalone utility 與測試**

```bash
rm src/handwritten/utils/mime-from-ext.ts
rm test/handwritten/mime-from-ext.test.ts
```

- [ ] **步驟 6：檢查沒有舊 import/path**

```bash
rg "mime-from-ext|mimeFromExt" src test
```

預期：只剩 `src/handwritten/commands/email/send.ts` 內的私有 helper 和呼叫。

- [ ] **步驟 7：執行 focused checks**

```bash
npm test -- test/handwritten/email-send.test.ts
npm run typecheck
git diff --check
```

預期：全部通過。

- [ ] **步驟 8：commit**

```bash
git add src/handwritten/commands/email/send.ts src/handwritten/utils/mime-from-ext.ts test/handwritten/email-send.test.ts test/handwritten/mime-from-ext.test.ts
git commit -m "refactor(email): inline attachment mime helper"
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
npm test -- test/handwritten/email-send.test.ts
npm run typecheck
git diff --check origin/main..HEAD
rg "mime-from-ext|mimeFromExt" src test
env -u NO_COLOR FORCE_COLOR=1 npm test
```

預期：focused tests、typecheck、diff check、full suite 全部通過；`rg` 只剩 `email/send.ts` 私有 helper。

- [ ] **步驟 3：Ponytail review**

檢查 diff 是否還有能刪的複雜度。這個 task 應刪掉 standalone utility/test；若沒有新發現就進入 PR。

- [ ] **步驟 4：draft PR 與 todo comment**

```bash
git push -u origin codex/inline-email-mime-helper
gh pr create --draft --base main --head codex/inline-email-mime-helper --title "Inline single-use email MIME helper" --body-file /tmp/inline-email-mime-helper-pr.md
npx -y -p @wspc/cli@latest wspc todo comment add tod_01KVND9540E3NEY9G7544EQ9S8 "<summary>"
```

預期：draft PR body 包含 Todo ID、spec path、plan path、verification commands 與 e2e-smoke note。

## 自我檢查

Spec 覆蓋：本計畫刪除 standalone MIME utility/test，MIME table 不擴大、不新增 dependency，attachment request body shape 與 error messages 不變。

Placeholder 掃描：沒有 placeholder。

型別一致性：`mimeFromExt(filename: string): string` 維持原 signature，但只留在 `email/send.ts` 私有範圍。

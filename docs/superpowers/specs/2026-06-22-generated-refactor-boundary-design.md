# Generated Refactor Boundary Design

## 來源

這份 spec 對應 WSPC todo `tod_01KVPC4ZZ9N320PDWREXYA1DES`：`Document generated-source refactor boundary in AGENTS and CLAUDE`。

## 目標

在 `AGENTS.md` 與 `CLAUDE.md` 補上一條 agent-facing 開發規則：refactoring 時不要手動修改 `src/generated/` 內的檔案，因為它們是 codegen 產物。

如果 generated output 真的需要變更，應該修改它的來源，例如 OpenAPI metadata、`tools/cli-codegen/`、或 handwritten/source layer，再透過既有 generate pipeline 重新產生。

## 目前狀態

`DEVELOPER.md` 已經明確說明：

- `src/generated/` 是產物，不要手改。
- 一般 API command 走 OpenAPI `x-cli` 到 `tools/cli-codegen/` 再到 `src/generated/cli/`。
- 新增或修正 command shape 時，優先改 OpenAPI metadata 或 generator。
- 更新 generated output 時要一併提交 regenerated diff。

`AGENTS.md` 與 `CLAUDE.md` 是更常被 agent 先讀到的工作規則，但目前還沒有把 refactor 時的 generated-source boundary 寫進去。這會讓簡單 refactor 任務有機會誤碰 `src/generated/`，產生難維護的手改產物。

## 設計

採用最小文件更新：只在 `AGENTS.md` 與 `CLAUDE.md` 的「開發風格」區塊新增同一條 bullet。

建議 wording：

```markdown
- **Generated 產物不手改**：refactoring 時不要修改 `src/generated/` 內檔案；那是 OpenAPI / CLI codegen 產物。若 generated output 需要變更，改 OpenAPI metadata、`tools/cli-codegen/` 或 handwritten/source layer，再重新 generate。
```

這條規則放在「小 commit」與「不寫無謂註解」附近即可，因為它是 refactor/change discipline，不是 repo layout 介紹。

## 範圍

包含：

- 更新 `AGENTS.md`。
- 更新 `CLAUDE.md`。
- 保持兩份 agent guidance 的 wording 一致。

不包含：

- 不修改 `DEVELOPER.md`，因為它已經有完整 generated-output 規則。
- 不修改 `src/generated/`。
- 不執行 `npm run generate`。
- 不新增測試；這是文件規則更新。

## 測試

最小驗證：

```bash
git diff --check
```

這是 docs-only 變更，不需要 typecheck、build 或 generated pipeline。

## 接受標準

- `AGENTS.md` 與 `CLAUDE.md` 都明確提到 refactoring 時不要手動修改 `src/generated/`。
- wording 指向正確來源：OpenAPI metadata、`tools/cli-codegen/` 或 handwritten/source layer。
- PR 若只有此文件/spec 更新，標題應包含 `[skip deploy]`。

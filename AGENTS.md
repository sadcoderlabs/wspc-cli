> 這是唯一正本，`CLAUDE.md` 是指向本檔的 symlink。要改指引改這裡，不要動 `CLAUDE.md`。

# 語言規則

- 對話、討論、解釋：繁體中文
- README.md / DEVELOPER.md / CLAUDE.md / AGENTS.md：以中文為主，技術術語（HTTP、RPC、TDD、worker、binding 等）保留英文
- docs/superpowers/ 下的所有文件（spec、plan、研究筆記等）：一律繁體中文撰寫散文段落、章節標題、表格內容。技術術語保留英文
- 程式碼、程式碼註解、commit message、issue/PR 標題、log 訊息字串：英文
- PR 敘述（body）：繁體中文。技術術語、錯誤訊息、路徑、程式碼區塊保留英文原文。PR 標題維持英文（見上一條）

# Repo 導覽

- README.md：vision、roadmap、本機開發快速入口
- DEVELOPER.md：current-practice 詳細參考
- docs/superpowers/specs/：每個 POC / feature 的設計規格
- docs/superpowers/plans/：對應的實作計畫（任務拆解）

開始任何新工作前，先看相關的 spec（如果有）；spec 與實作不一致時優先更新 spec、再改實作。

## 開發風格

- **TDD 優先**：實作功能前先寫失敗測試，跑一次確認失敗，再實作。Spec 與 plan 預設這個流程。
- **小 commit**：每完成一個 task 就 commit，commit message 用 conventional 格式（`feat(scope): ...`、`fix(scope): ...`、`docs(scope): ...`、`chore: ...`）。
- **Generated 產物不手改**：refactoring 時不要修改 `src/generated/` 內檔案；那是 OpenAPI / CLI codegen 產物。若 generated output 需要變更，改 OpenAPI metadata、`tools/cli-codegen/` 或 handwritten/source layer，再重新 generate。
- **不寫無謂註解**：好的命名取代註解；只在 why 不明顯（隱藏約束、特殊 workaround、會讓讀者驚訝的行為）時補一行英文。
- **空值表示**：除非第三方 library 已經使用 `null` 為 API 輸入 / 輸出，一律使用 `undefined` 代表空值。
- **時間 / 日期 / 時區處理**：碰時間數學、解析、格式化、時區轉換一律用 [Luxon](https://github.com/moment/luxon) `DateTime`；`Date.now()` 取現在 Unix ms 仍合法；boundary 序列化採 ISO 8601 + offset（使用者語意時間）/ Unix ms（系統 timestamp）/ ISO date-only（全天事件）。完整規則、禁止清單、範例見 [time handling convention spec](docs/superpowers/specs/2026-05-06-time-handling-convention-design.md)。
- Operator-only 設定（secret、deploy 流程、本機 dev）與程式寫作規範改 [`DEVELOPER.md`](DEVELOPER.md)。
- **僅文件 / spec 更新 skip deploy**：如果這次的 PR 只有文件或 spec 更新，在 PR 的標題上加上 `[skip deploy]`。PR 階段會 job-level skip CI heavy jobs，merge 後也會 skip production deploy。不要把這個旗標用在程式碼、workflow、API surface 或其他需要 CI 驗證的改動。

## PR 敘述怎麼寫

用繁體中文寫。技術術語、錯誤訊息與路徑保留英文原文，標題還是英文。

按這個順序寫，順序本身就是重點：

1. **使用者遇到的問題。** 第一段就講使用者實際看到什麼，用他們的語言，不要用內部術語。不是「快取的 key 沒有失效」，是「改了設定之後，舊的值還會再出現一個小時」。看 PR 的人第一個要知道的是「這在修什麼」，不是「這改了哪一行」。
2. **背景。** 讀懂這個 bug 需要先知道的前提，假設讀的人沒有這塊的 context。單一檔案的小修正可以省略；只要牽涉兩個以上元件的互動就不要省。
3. **問題出在哪裡。** 用講給 junior engineer 聽的方式。貼出有問題的那幾行，說明它原本想做什麼、實際做了什麼、以及為什麼平常看不出來。「平常這兩件事是同一件事，所以看不出差別」這種句子，比「edge case」有用得多。
4. **修法。** 貼出改完的程式碼，然後解釋**為什麼是這樣改**。特別是那些看起來多餘、其實不能省的部分，要講清楚省掉會發生什麼事。
5. **這個 PR 不修什麼。** 如果根因還沒解、或刻意只做一半，明講。不要讓 reviewer 以為問題結案了。
6. **已知副作用。** 有就寫。
7. **測試。** 測了什麼行為，以及**改動前是怎麼紅的**，貼出失敗訊息。

不要寫的東西：

- 不要重複 commit message。commit 講「改了什麼」，PR 講「為什麼」。
- 不要只貼 diff 摘要，GitHub 已經有了。
- 不要用「修了一個 edge case」帶過。是哪個 edge case、為什麼會走到那裡。

## 不要做的事

- 不要在 commit message 加 AI co-author trailer（這個 repo 不接受）
- 不要 `git push --force` 到 `main` / `master`，要先問
- 不要 amend 已經 push 出去的 commit
- 不要為了避開驗證去用 `--no-verify` / `--no-gpg-sign`，先解決根本問題
- 不要把 `docs/superpowers/` 的散文寫成英文（程式碼區塊例外）

## Agent skills

### Issue tracker

Issues 與 PRDs 使用 WSPC todos 管理。詳見 `docs/agents/issue-tracker.md`。

### Triage labels

使用五個標準 triage roles：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。詳見 `docs/agents/triage-labels.md`。

### Domain docs

採 single-context layout：root `CONTEXT.md` 與 `docs/adr/`。詳見 `docs/agents/domain.md`。

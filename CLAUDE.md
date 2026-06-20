# 語言規則

- 對話、討論、解釋：繁體中文
- README.md / DEVELOPER.md / CLAUDE.md：以中文為主，技術術語（HTTP、RPC、TDD、worker、binding 等）保留英文
- docs/superpowers/ 下的所有文件（spec、plan、研究筆記等）：一律繁體中文撰寫散文段落、章節標題、表格內容。技術術語保留英文
- 程式碼、程式碼註解、commit message、issue/PR 標題、log 訊息字串：英文

# Repo 導覽

- README.md：vision、roadmap、本機開發快速入口
- DEVELOPER.md：current-practice 詳細參考
- docs/superpowers/specs/：每個 POC / feature 的設計規格
- docs/superpowers/plans/：對應的實作計畫（任務拆解）

開始任何新工作前，先看相關的 spec（如果有）；spec 與實作不一致時優先更新 spec、再改實作。

## 開發風格

- **TDD 優先**：實作功能前先寫失敗測試，跑一次確認失敗，再實作。Spec 與 plan 預設這個流程。
- **小 commit**：每完成一個 task 就 commit，commit message 用 conventional 格式（`feat(scope): ...`、`fix(scope): ...`、`docs(scope): ...`、`chore: ...`）。
- **不寫無謂註解**：好的命名取代註解；只在 why 不明顯（隱藏約束、特殊 workaround、會讓讀者驚訝的行為）時補一行英文。
- **空值表示**：除非第三方 library 已經使用 `null` 為 API 輸入 / 輸出，一律使用 `undefined` 代表空值。
- **時間 / 日期 / 時區處理**：碰時間數學、解析、格式化、時區轉換一律用 [Luxon](https://github.com/moment/luxon) `DateTime`；`Date.now()` 取現在 Unix ms 仍合法；boundary 序列化採 ISO 8601 + offset（使用者語意時間）/ Unix ms（系統 timestamp）/ ISO date-only（全天事件）。完整規則、禁止清單、範例見 [time handling convention spec](docs/superpowers/specs/2026-05-06-time-handling-convention-design.md)。
- Operator-only 設定（secret、deploy 流程、本機 dev）與程式寫作規範改 [`DEVELOPER.md`](DEVELOPER.md)。
- **僅文件 / spec 更新 skip deploy**：如果這次的 PR 只有文件或 spec 更新，在 PR 的標題上加上 `[skip deploy]`。PR 階段會 job-level skip CI heavy jobs，merge 後也會 skip production deploy。不要把這個旗標用在程式碼、workflow、API surface 或其他需要 CI 驗證的改動。

## 不要做的事

- 不要在 commit message 加 AI co-author trailer（這個 repo 不接受）
- 不要 `git push --force` 到 `main` / `master`，要先問
- 不要 amend 已經 push 出去的 commit
- 不要為了避開驗證去用 `--no-verify` / `--no-gpg-sign`，先解決根本問題
- 不要把 `docs/superpowers/` 的散文寫成英文（程式碼區塊例外）

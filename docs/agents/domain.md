# Domain docs

Engineering skills 在探索 codebase 前，依本文件讀取 domain documentation。

## 探索前閱讀

- Root `CONTEXT.md`。
- `docs/adr/` 中與工作範圍相關的 ADR。
- 若未來出現 root `CONTEXT-MAP.md`，依其指引讀取與工作範圍相關的 context-specific `CONTEXT.md` 與 ADR。

上述檔案不存在時，直接繼續，不需要回報缺失，也不要預先建立空文件。Domain terminology 或 architectural decision 真正被釐清時，再由 domain-modeling workflow 建立。

## File structure

本 repo 採 single-context layout：

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-example-decision.md
│       └── 0002-another-decision.md
└── src/
```

## 使用 glossary vocabulary

Issue title、refactor proposal、hypothesis 與 test name 應使用 `CONTEXT.md` 定義的 domain terminology，不要改用 glossary 明確排除的同義詞。

需要的概念尚未出現在 glossary 時，先確認是否只是使用了 project 不採用的語言；若確實是 domain gap，再交由 domain-modeling workflow 處理。

## ADR conflicts

若提案與現有 ADR 衝突，必須明確指出，不得默默覆寫。例如：

> 與 ADR-0007 的既有決策衝突；若要繼續，需先重新開啟該決策。

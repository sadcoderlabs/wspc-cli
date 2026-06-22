# Generated Refactor Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generated-source refactor guidance to `AGENTS.md` and `CLAUDE.md`.

**Architecture:** This is a docs-only guidance update. `DEVELOPER.md` already owns the detailed generated-output policy, so this plan duplicates only the short refactor boundary in the agent-facing files.

**Tech Stack:** Markdown, Git.

---

## File Structure

- Modify: `AGENTS.md`
  Add one bullet under `## 開發風格`.
- Modify: `CLAUDE.md`
  Add the same bullet under `## 開發風格`.

No code, generated output, tests, OpenAPI snapshot, or generator files should change.

### Task 1: Add Generated Refactor Boundary

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm baseline wording**

Run:

```bash
rg -n "src/generated|Generated 產物不手改|小 commit|不寫無謂註解" AGENTS.md CLAUDE.md DEVELOPER.md
```

Expected: `DEVELOPER.md` mentions `src/generated/`; `AGENTS.md` and `CLAUDE.md` do not yet contain `Generated 產物不手改`.

- [ ] **Step 2: Update `AGENTS.md`**

In `AGENTS.md`, insert this bullet immediately after the `小 commit` bullet in `## 開發風格`:

```markdown
- **Generated 產物不手改**：refactoring 時不要修改 `src/generated/` 內檔案；那是 OpenAPI / CLI codegen 產物。若 generated output 需要變更，改 OpenAPI metadata、`tools/cli-codegen/` 或 handwritten/source layer，再重新 generate。
```

- [ ] **Step 3: Update `CLAUDE.md`**

In `CLAUDE.md`, insert the same bullet immediately after the `小 commit` bullet in `## 開發風格`:

```markdown
- **Generated 產物不手改**：refactoring 時不要修改 `src/generated/` 內檔案；那是 OpenAPI / CLI codegen 產物。若 generated output 需要變更，改 OpenAPI metadata、`tools/cli-codegen/` 或 handwritten/source layer，再重新 generate。
```

- [ ] **Step 4: Verify only intended files changed**

Run:

```bash
git diff --name-only
```

Expected:

```text
AGENTS.md
CLAUDE.md
```

- [ ] **Step 5: Verify wording appears in both files**

Run:

```bash
rg -n "Generated 產物不手改|src/generated|tools/cli-codegen" AGENTS.md CLAUDE.md
```

Expected: both files contain the new bullet and mention `src/generated/` plus `tools/cli-codegen/`.

- [ ] **Step 6: Run docs whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs(guidance): document generated refactor boundary"
```

## Self-Review

- Spec coverage: covers `AGENTS.md`, `CLAUDE.md`, no `DEVELOPER.md`, no `src/generated/`, no generate pipeline.
- Completeness check: no open blanks.
- Type consistency: not applicable; docs-only plan.

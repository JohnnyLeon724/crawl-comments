---
name: comment-excel-delivery
description: Semi-automated comment-to-Excel delivery workflow for 客户需求 Excel, B站历史交付表, MCP/AI DOM comment extraction, normalized comment JSONL, QA, resume planning, and delivery.xlsx generation. Use when Codex needs to parse target links from client spreadsheets, coordinate comment extraction, structure comments with AI, or produce/reproduce client Excel deliverables.
---

# Comment Excel Delivery

Use this skill to run the local semi-automated comment delivery pipeline in this repository.

The split of responsibility is fixed:

- Scripts parse Excel, normalize JSON, merge runs, QA, resume, and generate workbooks.
- Chrome is the default browser execution surface. Use `chrome:control-chrome` and `src/browser/chrome-comment-capture.js` to operate the user's logged-in Chrome session: open a fresh task tab, expand only safe exact visible text within the unique comment root, scroll that container through Chrome CUA, capture bounded DOM candidate batches, and close/finalize the tab after the task.
- MCP/CDP tools remain fallback/debug paths for reproducing legacy behavior, comparing candidate capture, or continuing when Chrome extension control is unavailable.
- AI reads DOM candidate batches and produces structured comment JSON that matches the project schema.

Before executing a project, read [references/workflow.md](references/workflow.md). It contains the command order, artifact names, and acceptance checks.

## Operating Rules

1. Keep every customer project under one output directory such as `output/<project_id>/`.
2. For browser capture, default to `chrome:control-chrome`. Pause for user action when login, CAPTCHA, verification, or platform access checks appear; do not bypass them or substitute another source.
3. For Douyin `user?...modal_id=...` links, extract `modal_id` and open `/video/<modal_id>` as the task target so scrolling stays in the detail comment container instead of the short-video feed.
4. Use only an explicit platform profile. `PLATFORM_PROFILES.douyin` is the only built-in profile; other platforms need an explicit safe comment root and item selector or must use the fallback. Never click a shared CSS class, `收起`, `展开全文`, product, or detail controls.
5. Keep page evaluation read-only. The adapter may inspect the scoped comment root, but expansion uses `getByText(label, { exact: true })` under that root and scrolling uses Chrome CUA coordinates.
6. After expand or comment-area clicks, close accidental Chrome tabs such as commenter profile or creator profile pages before continuing the task.
7. Default delivery mode is full completion. Unless the user explicitly asks for smoke, sample, test-only, a specific task subset, or a fixed batch limit, continue browser capture, AI extraction, normalization, merge, QA, and resume loops until every task passes the completion gate.
8. Do not treat partial QA as complete. If `qa-summary.status` is not `ok`, run `src/pipeline/resume_comment_project.py`, rerun the suggested task actions with elastic capture parameters, and rebuild QA before generating a final delivery.
9. Keep every target link under `runs/<task_id>/` with `task.json`, `capture-state.json`, `batches/<batch_id>/`, task-level normalized JSONL, and QA artifacts. Record `declared_comment_count`, `captured_record_count`, `count_gap`, and the end signal when available; the displayed-versus-rendered gap is an observation, not an automatic QA failure.
10. Do not ask AI to directly write Excel. Generate Excel through `src/pipeline/build_client_comment_excel.py` only after the completion gate is satisfied, unless the user explicitly requested a smoke/test artifact.
11. Use `src/pipeline/resume_comment_project.py` before rerunning a partially completed project; write reruns to the suggested rerun directory.
12. For historical B站 delivery files, import them with `src/pipeline/import_bilibili_delivery.py` instead of manually mapping columns.
13. Before claiming completion, run the relevant Python pipeline tests and, when JS/MCP behavior is touched, run the Node tests.

## Expected Outputs

- `crawl-tasks.json`
- `run-manifest.json`
- `runs/<task_id>/task.json`
- `runs/<task_id>/capture-state.json`
- `runs/<task_id>/batches/<batch_id>/comment-dom-batch.json`
- `runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json`
- `runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl`
- `runs/<task_id>/normalized-comments.jsonl`
- `runs/<task_id>/batch-merge-summary.json`
- `all-normalized-comments.jsonl`
- `qa-summary.json`
- `batch-summary.json`
- `resume-plan.json` when resuming
- `delivery.xlsx`

`comment-dom-snapshot.json` and the old MCP/CDP expand-then-capture path remain fallback artifacts for small pages or debugging. The default browser execution surface is `chrome:control-chrome`.

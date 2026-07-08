---
name: comment-excel-delivery
description: Semi-automated comment-to-Excel delivery workflow for 客户需求 Excel, B站历史交付表, MCP/AI DOM comment extraction, normalized comment JSONL, QA, resume planning, and delivery.xlsx generation. Use when Codex needs to parse target links from client spreadsheets, coordinate comment extraction, structure comments with AI, or produce/reproduce client Excel deliverables.
---

# Comment Excel Delivery

Use this skill to run the local semi-automated comment delivery pipeline in this repository.

The split of responsibility is fixed:

- Scripts parse Excel, normalize JSON, merge runs, QA, resume, and generate workbooks.
- MCP/browser tools expand comments, scroll, and capture bounded DOM candidate batches. The default browser step is `expand_and_capture_comment_batches`.
- AI reads DOM candidate batches and produces structured comment JSON that matches the project schema.

Before executing a project, read [references/workflow.md](references/workflow.md). It contains the command order, artifact names, and acceptance checks.

## Operating Rules

1. Keep every customer project under one output directory such as `output/<project_id>/`.
2. Keep every target link under `runs/<task_id>/` with `task.json`, `capture-state.json`, `batches/<batch_id>/`, task-level normalized JSONL, and QA artifacts.
3. Do not ask AI to directly write Excel. Generate Excel through `src/pipeline/build_client_comment_excel.py`.
4. Use `src/pipeline/resume_comment_project.py` before rerunning a partially completed project; write reruns to the suggested rerun directory.
5. For historical B站 delivery files, import them with `src/pipeline/import_bilibili_delivery.py` instead of manually mapping columns.
6. Before claiming completion, run the relevant Python pipeline tests and, when JS/MCP behavior is touched, run the Node tests.

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

`comment-dom-snapshot.json` and the old expand-then-capture path remain fallback artifacts for small pages or debugging, but the default path is `expand_and_capture_comment_batches`.

---
name: comment-excel-delivery
description: Semi-automated comment-to-Excel delivery workflow for 客户需求 Excel, B站历史交付表, MCP/AI DOM comment extraction, normalized comment JSONL, QA, resume planning, and delivery.xlsx generation. Use when Codex needs to parse target links from client spreadsheets, coordinate comment extraction, structure comments with AI, or produce/reproduce client Excel deliverables.
---

# Comment Excel Delivery

Use this skill to run the local semi-automated comment delivery pipeline in this repository.

The split of responsibility is fixed:

- Scripts parse Excel, normalize JSON, merge runs, QA, resume, and generate workbooks.
- Chrome is the default browser execution surface. Use `chrome:control-chrome` and `src/browser/chrome-comment-capture.js` to operate the user's logged-in Chrome session: open a fresh task tab, expand only safe exact visible text within the unique comment root, scroll that container through Chrome CUA, capture bounded DOM candidate batches, and close/finalize the tab after the task.
- MCP/CDP tools remain fallback/debug paths for reproducing legacy behavior, comparing candidate capture, or continuing when Chrome extension control is unavailable. This fallback never applies to Weibo comment tasks.
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

## Weibo Comment Tasks: Chrome/model-only

Weibo comment collection is Chrome/model-only. `chrome:control-chrome` and model extraction are mandatory: collect only from the logged-in, visible Weibo comment UI, then structure only the saved DOM candidates. There is **no MCP/API fallback** for Weibo comments; do not call comment APIs, OpenCLI, MCP/CDP, or another source when Chrome is blocked.

1. Require a validated explicit Weibo profile with unique comment root, sort scope, comment item, reply container, scroll container, and identity configuration. Read only the explicit profile scope; do not guess selectors or inspect a page-wide comment-like region.
2. Capture both primary-comment streams: switch and verify `按热度`, finish its safe scoped capture, then switch and verify `按时间` and capture it. Expand only exact approved reply labels and scroll only the observed comment container.
3. Browser capture batches are evidence-only and are retained for audit and resume. Deduplicate their candidates before model extraction; model batches contain at most 80 candidates/24,000 characters, whichever limit is reached first.
4. Chrome must provide identity evidence. Preserve `source_comment_id` (and parent/root IDs) when visible; otherwise use only the complete deterministic public-DOM composite fingerprint. A composite-only Weibo task is always `partial` and must never claim dual-sort all-complete.
5. Generate `model-output-schema.json` from the canonical extraction schema before each local Codex invocation so the strict model schema is compatible. The model may extract fields from candidates, but cannot invent IDs, browse URLs, click controls, or change sort state.
6. On login, CAPTCHA, verification, access limits, ambiguous profile scope, failed sort verification, or incomplete reply expansion, stop and retain the scoped evidence as `partial` or `failed`. Ask the user to resolve access checks; do not bypass them.

## Weibo Historical Semantic Delivery

`docs/weibo_comments_all.xlsx` is a **历史导入** input for analysis of already delivered Weibo comments. It is not a replacement for Chrome/model-only collection and must stay isolated from a live Chrome project such as `output/weibo_Qz3Tr1mPS_dual_sort_test/`; do not use historical rows to fill a live task's declared comment count or `partial` gap.

1. Import only the workbook's `微博汇总` and `评论明细` sheets with `src/pipeline/import_weibo_comment_history.py`. Keep original phase, post link, floor/reply context, author, time and engagement fields, but do not fabricate comment IDs.
2. This input has no post body. **不补读历史微博正文**: do not call Chrome, MCP, API, OpenCLI, CDP, or another source to retrieve it. The `按帖子楼层展示` sheet groups by creator, link, phase and engagement count instead of rendering a post body.
3. Prepare automatic model-capacity batches with `script/prepare-comment-ai-review.js` using both limits: 80 records and 24,000 characters. These review batches are context limits, not additional capture batches.
4. Run local Codex review with `script/run-comment-ai-review.js --resume`, then require one valid output for every imported `row_key` through `script/validate-comment-ai-review.js`. Only the current comment/reply receives a label; replies include root-comment and reply-target context.
5. Generate a stratified review sample with `script/build-comment-qa-sample.js`, then generate the five-sheet formal workbook with `script/build-weibo-history-semantic-report.mjs`. The builder uses Artifact Tool and refuses `delivery.xlsx` unless semantic QA is `ok`.
6. The formal output directory is `output/weibo_historical_comment_semantic_2026-07-10/`. Retain `history-import-summary.json`, `ai-review-input/`, `semantic-qa-summary.json`, `qa-sample.jsonl`, `delivery.xlsx`, and the five previews for audit.

There is no MCP/API fallback for Weibo comment collection. Historical import is a local workbook-analysis path only; it does not authorize any API or browser retrieval of missing live or post-body data.

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

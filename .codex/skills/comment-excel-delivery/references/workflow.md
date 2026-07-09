# Comment Excel Delivery Workflow

## 1. Choose Input Type

For a normal customer requirement workbook, parse tasks:

```bash
python src/pipeline/parse_client_requirements.py \
  --input "<client_requirements.xlsx>" \
  --phase "<phase_name>" \
  --out-dir output/<project_id>
```

The client workbook path is not fixed. Use any customer requirement Excel file with the same column layout as the supported requirement template, such as a new test workbook under `docs/` or another local path.

For an existing B站 delivery workbook, import it into the same project shape:

```bash
python src/pipeline/import_bilibili_delivery.py \
  --input docs/bilibili_comments_all_phases.xlsx \
  --out-dir output/<project_id>
```

## 2. Run One Task

For each `runs/<task_id>/task.json`, use `chrome:control-chrome` as the default browser execution surface.

### Chrome default per-task workflow

1. Connect to Chrome through the Chrome skill and use the user's logged-in Chrome session.
2. Open a fresh tab for `task.source_url`; do not manually reuse an old content tab as the task target.
3. Confirm the current page is the intended Douyin or Xiaohongshu target. If login, CAPTCHA, verification, privacy consent, or platform access checks appear, pause for user action and ask the user to handle them. Do not bypass the check or replace the platform page with another source.
4. Use Chrome automation to click visible expand controls such as comments, replies, "展开更多", or "展开 N 条回复". Prefer bounded, repeated rounds over one large page scrape.
5. In each round, capture the current visible comment candidate DOM before scrolling. Save non-empty batches using the existing schema and paths:

```text
output/<project_id>/runs/<task_id>/
  capture-state.json
  batches/<batch_id>/comment-dom-batch.json
```

6. Each `comment-dom-batch.json` must stay compatible with `comment-dom-batch-v1` and include `candidate_id`, `candidate_hash`, `dom_path`, `role_hint`, `inner_text`, `html`, `nearby_buttons`, `rect`, and `captured_at` for candidates when available.
7. Update `capture-state.json` with `last_batch_id`, `next_batch_id`, seen candidate hashes, round counts, candidate totals, and stop reason.
8. Stop after idle, navigation away, user-required verification, or configured runtime/batch limits. Close or finalize the task tab before moving to the next task.
9. For each batch, read `prompts/comment-candidate-batch-extraction.md` and `schemas/ai-comment-extraction.schema.json`.
10. Have AI output `batches/<batch_id>/ai-comment-extraction.json`, using `candidate_id` as `source_chunk_id`.
11. Normalize each batch:

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json \
  --batch output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json \
  --task output/<project_id>/runs/<task_id>/task.json \
  --out output/<project_id>/runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl
```

12. Merge task batches:

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/<project_id>/runs/<task_id>
```

### MCP/CDP fallback

Use MCP/CDP only when Chrome extension control is unavailable, when the user explicitly requests the legacy path, or when debugging MCP capture behavior.

Coordinate clicking remains the MCP fallback production interaction mode. The fallback main tool is `expand_and_capture_comment_batches`:

```text
{
  "sourceUrl": "<task.source_url>",
  "outDir": "output/<project_id>/runs/<task_id>",
  "taskId": "<task_id>",
  "maxRuntimeMs": 1800000,
  "maxRounds": 800,
  "maxBatches": 300,
  "maxIdleRounds": 8,
  "maxClicksPerRound": 3,
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "clickMode": "coordinate",
  "fallbackClickMode": "dom-click",
  "clickJitterPx": 4,
  "mouseMoveStepsMin": 4,
  "mouseMoveStepsMax": 9,
  "clickDownMsMin": 60,
  "clickDownMsMax": 160,
  "clickGapMsMin": 300,
  "clickGapMsMax": 900,
  "postClickWaitMsMin": 800,
  "postClickWaitMsMax": 1600,
  "closePageAfter": true
}
```

Additional fallback/debug tools:

- Use `expand_current_page_comments` only when you need the legacy raw payload for comparison.
- Use `capture_comment_candidate_batch` or `capture_comment_candidate_batches_until_idle` only when manually controlling capture batches.
- Use `comment-dom-snapshot.json` and `prompts/comment-dom-extraction.md` only as a small-page fallback or debug path.

## 3. Merge, QA, And Build Excel

Merge all normalized task outputs:

```bash
python src/pipeline/merge_comment_runs.py \
  --project-dir output/<project_id> \
  --out output/<project_id>/all-normalized-comments.jsonl
```

Generate QA:

```bash
python src/pipeline/qa_comment_delivery.py \
  --project-dir output/<project_id> \
  --out output/<project_id>/qa-summary.json
```

Generate batch summary for locating failed or unfinished batches:

```bash
python src/pipeline/build_batch_summary.py \
  --project-dir output/<project_id> \
  --out output/<project_id>/batch-summary.json
```

Generate the client workbook:

```bash
python src/pipeline/build_client_comment_excel.py \
  --project-dir output/<project_id> \
  --template docs/michelin_kol_comments_all_platforms_0630.xlsx \
  --out output/<project_id>/delivery.xlsx
```

## 4. Resume Safely

Before rerunning any incomplete project:

```bash
python src/pipeline/resume_comment_project.py \
  --project-dir output/<project_id> \
  --out output/<project_id>/resume-plan.json
```

Use `action`:

- `skip`: do not touch completed output.
- `run`: use the canonical `runs/<task_id>` directory.
- `rerun`: write to `runs/<task_id>/reruns/<resume_id>` to avoid overwriting previous work.

## 5. Verification

Run Python pipeline tests:

```bash
python -m unittest discover -s test/pipeline
```

Run Node tests when JS normalizers, adapters, MCP, or browser scripts changed:

```bash
node --test --test-reporter=dot test/*.test.js
```

Use a real smoke test when touching an importer or Excel generator. Current useful fixtures:

- `docs/米其林评论区分析KOL link-0630.xlsx`
- `docs/bilibili_comments_all_phases.xlsx`
- `docs/michelin_kol_comments_all_platforms_0630.xlsx`

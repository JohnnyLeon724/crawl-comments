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

For each `runs/<task_id>/task.json`:

1. Keep Chrome running with CDP enabled and the target platform logged in. Do not manually reuse an old content tab as the task target.
2. Use `expand_and_capture_comment_batches` as the default comment browser step. Pass the task URL as `sourceUrl`; the MCP tool opens a fresh task page, expands visible replies, captures DOM candidates before scrolling, saves bounded batches, and stops after idle, navigation-away, or configured limits:

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

Coordinate clicking is used for production interaction compatibility. The tool validates the click point before pressing, skips obvious user/profile links, and stops with `navigation-away` if a click still leaves the source page. If coordinate input is unavailable, the MCP tool falls back to `dom-click`; login, CAPTCHA, or verification pages should stop the run for user action.

3. Use `capture-state.json` to confirm the generated batch range. The tool writes `batches/<batch_id>/comment-dom-batch.json` for non-empty batches.
4. For each batch, read `prompts/comment-candidate-batch-extraction.md` and `schemas/ai-comment-extraction.schema.json`.
5. Have AI output `batches/<batch_id>/ai-comment-extraction.json`, using `candidate_id` as `source_chunk_id`.
6. Normalize each batch:

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json \
  --batch output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json \
  --task output/<project_id>/runs/<task_id>/task.json \
  --out output/<project_id>/runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl
```

7. Merge task batches:

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/<project_id>/runs/<task_id>
```

Fallback/debug path:

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

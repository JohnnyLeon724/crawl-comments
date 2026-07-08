# Comment Excel Delivery Workflow

## 1. Choose Input Type

For a normal customer requirement workbook, parse tasks:

```bash
python src/pipeline/parse_client_requirements.py \
  --input "docs/米其林评论区分析KOL link-0630.xlsx" \
  --phase "KOL link-0630" \
  --out-dir output/<project_id>
```

For an existing B站 delivery workbook, import it into the same project shape:

```bash
python src/pipeline/import_bilibili_delivery.py \
  --input docs/bilibili_comments_all_phases.xlsx \
  --out-dir output/<project_id>
```

## 2. Run One Task

For each `runs/<task_id>/task.json`:

1. Open the task URL in the logged-in browser.
2. Use the comment-crawler MCP to expand comments and replies.
3. Save the raw payload if a fallback/debug copy is needed.
4. Capture one bounded candidate batch with `capture_comment_candidate_batch`:

```text
{
  "outDir": "output/<project_id>/runs/<task_id>",
  "taskId": "<task_id>",
  "batchId": "batch_0001",
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "scrollAfterCapture": true,
  "scrollStepRatio": 0.85,
  "closePageAfter": false
}
```

5. Repeat batch capture into `batches/<batch_id>/comment-dom-batch.json` until the page produces no new candidates or the task is judged complete. On the final MCP page call for this task, pass `closePageAfter: true` so the selected Chrome tab closes before the next task opens.
6. For each batch, read `prompts/comment-candidate-batch-extraction.md` and `schemas/ai-comment-extraction.schema.json`.
7. Have AI output `batches/<batch_id>/ai-comment-extraction.json`, using `candidate_id` as `source_chunk_id`.
8. Normalize each batch:

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json \
  --batch output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json \
  --task output/<project_id>/runs/<task_id>/task.json \
  --out output/<project_id>/runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl
```

9. Merge task batches:

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/<project_id>/runs/<task_id>
```

Use `comment-dom-snapshot.json` and `prompts/comment-dom-extraction.md` only as a small-page fallback or debug path.

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

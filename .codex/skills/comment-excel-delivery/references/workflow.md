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
3. Capture `comment-dom-snapshot.json`.
4. Read `prompts/comment-dom-extraction.md` and `schemas/ai-comment-extraction.schema.json`.
5. Have AI output `ai-comment-extraction.json`.
6. Normalize:

```bash
node script/normalize-ai-comment-extraction.js \
  --run-dir output/<project_id>/runs/<task_id> \
  --task output/<project_id>/runs/<task_id>/task.json
```

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

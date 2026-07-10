# Handoff: finish Weibo historical semantic delivery

## Objective

Finish the historical Weibo comment semantic delivery and produce `output/weibo_historical_comment_semantic_2026-07-10/delivery.xlsx` without changing the Chrome/model-only policy for new Weibo comment collection.

## Authoritative artifacts

- Design: `docs/superpowers/specs/2026-07-10-weibo-historical-comment-semantic-delivery-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-weibo-historical-comment-semantic-delivery.md`
- Rules: `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`
- Input: `docs/weibo_comments_all.xlsx`
- Runtime project: `output/weibo_historical_comment_semantic_2026-07-10/`

Do not duplicate or reinterpret those documents. Historical analysis is isolated from `output/weibo_Qz3Tr1mPS_dual_sort_test/`; never use historical rows to fill its Chrome `partial` gap.

## Completed implementation commits

- `dbabc48` — read-only historical workbook importer and test.
- `0202e3e` — 80-record/24,000-character review batching, resume and strict review QA.
- `d2d8940` — five-sheet Weibo report content model.
- `6f25d05` — Artifact Tool Excel renderer with formulas, conditional formatting, and preview rendering.
- `7978c7c` — local-model strict-schema compatibility: model output is now a root object containing `results` instead of a root array; readers remain backward compatible.

The following documentation/test changes are verified but uncommitted and should be committed as one docs task before or after resuming the runtime project:

- `.codex/skills/comment-excel-delivery/SKILL.md`
- `.codex/skills/comment-excel-delivery/references/workflow.md`
- `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`
- `test/pipeline/test_comment_excel_delivery_skill.py`

## Verification already observed

- Historical import: 11 posts, 3,098 comments; 2,794 level-1 and 304 level-2; no duplicate, orphan, missing URL, or missing text rows.
- Local model rejected the former top-level-array strict schema with HTTP 400 `invalid_json_schema`. Commit `7978c7c` fixes the actual cause.
- A real post-fix diagnostic batch successfully wrote `review_001.json` as `{ "results": [...] }` with 80 rows.
- At handoff creation, 11 of 39 `review_*.json` files exist in `ai-review-input/`. The prior worker was interrupted intentionally; inspect whether a process is still writing before starting another runner.
- Focused delivery-contract test: 13 passed. Full Python pipeline: 41 passed. Artifact Tool renderer integration previously passed 5 tests, including five sheet previews and formula-error scan.

## Resume procedure

1. Check the current review-file count and whether it is changing. Do not run two review runners against the same directory.
2. If no runner is active, resume only missing/incomplete batches:

```bash
node script/run-comment-ai-review.js \
  --input-dir output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --cwd /Users/gyp/Documents/demo \
  --resume
```

3. After 39 review files exist, run strict QA. It must report `status: "ok"`, `expected_count: 3098`, `review_count: 3098`, and `error_count: 0`:

```bash
node script/validate-comment-ai-review.js \
  --comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --out output/weibo_historical_comment_semantic_2026-07-10/semantic-qa-summary.json
```

4. Create a 60-row QA sample, then use the Artifact Tool renderer to generate `delivery.xlsx` and five previews. The renderer rejects non-`ok` QA:

```bash
node script/build-comment-qa-sample.js \
  --comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --sample-size 60 \
  --out output/weibo_historical_comment_semantic_2026-07-10/qa-sample.jsonl
```

Use the bundled workspace Node runtime and a temporary `node_modules` symlink only while invoking `script/build-weibo-history-semantic-report.mjs`; do not commit that symlink or anything under `output/`.

5. Render/inspect all five sheets, run the Node and Python suites, then commit the four pending docs/test files with a docs conventional-commit message.

## Safety and policy

- New Weibo comment collection remains Chrome/model-only. No MCP/API/CDP/OpenCLI fallback.
- Historical workbook analysis does not authorize browser/API retrieval of missing post text; the report groups by creator, link, phase, and engagement instead.
- Do not fabricate model outputs, comment IDs, or missing rows.

## Suggested skills

- `comment-excel-delivery` for project artifacts and completion gates.
- `test-driven-development` for any further code fix.
- `diagnosing-bugs` if a resumed local model batch fails.
- `spreadsheets:Spreadsheets` before modifying or verifying the final workbook.
- `verification-before-completion` before claiming formal delivery or committing follow-up work.

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

## 2. Delivery Mode And Completion Gate

Default delivery mode is full completion. Do not use smoke limits in default delivery mode, and do not stop the project just because one browser pass reached `maxBatches`, `maxRounds`, or `maxRuntimeMs`.

Smoke or sampling mode is allowed only when the user explicitly asks for it with words such as smoke, test, sample, only task X, or only N batches. In that case, generated files are a test artifact, not a complete delivery, and the final response must label them that way.

Completion gate for a formal `delivery.xlsx`:

- `qa-summary.status == "ok"`.
- `failed_count == 0`.
- `partial_count == 0`.
- Every task has task-level `normalized-comments.jsonl`.
- Every non-empty batch has `ai-comment-extraction.json` and `normalized-comments.jsonl`.

Do not treat partial QA as complete. After every QA run that is not `ok`, run:

```bash
python src/pipeline/resume_comment_project.py \
  --project-dir output/<project_id> \
  --out output/<project_id>/resume-plan.json
```

Then execute the suggested `run` or `rerun` actions, rebuild task merges, rebuild project merge, rerun QA, and repeat until the completion gate passes or a real blocker requires user action.

Capture parameters are elastic. Choose the initial browser-capture budget from `expected_comment_count`, platform behavior, observed candidates per batch, and remaining QA gaps:

- For small tasks, start with moderate limits and stop only after reliable idle/end-of-comments signals.
- For large tasks or QA gaps, increase maxBatches, maxRounds, and maxRuntimeMs before rerunning.
- Increase `maxIdleRounds` when a platform loads comments slowly or batches alternate between empty and non-empty.
- Increase `maxCandidates` or reduce `maxCharsPerCandidate` only when batches are truncating or too dense for AI extraction.
- Reduce parameters only for explicit smoke mode.

## 3. Run One Task

For each `runs/<task_id>/task.json`, use `chrome:control-chrome` as the default browser execution surface.

### Chrome default per-task workflow

1. Connect to Chrome through the Chrome skill and use the user's logged-in Chrome session.
2. Open a fresh tab for `task.source_url`; do not manually reuse an old content tab as the task target.
3. Before navigation, normalize Douyin user modal links. When `task.source_url` has the shape `user?...modal_id=...`, extract `modal_id` and directly open `https://www.douyin.com/video/<modal_id>` or the equivalent `/video/<modal_id>` detail URL. Do not run the task inside the Douyin short-video feed, because scrolling the short-video feed can switch to the next video. After the detail page opens, scroll only the comment container or platform detail pane.
4. Confirm the current page is the intended Douyin or Xiaohongshu target. If login, CAPTCHA, verification, privacy consent, or platform access checks appear, pause for user action and ask the user to handle them. Do not bypass the check or replace the platform page with another source.
5. Load `src/browser/chrome-comment-capture.js` after Chrome has been initialized. Use `PLATFORM_PROFILES.douyin` for Douyin. For any other platform, supply an explicit safe profile with a unique comment root and a comment item selector; do not guess a broad page root.
6. Capture the scoped comment root with `captureScopedRecords(tab, profile)`. Its page evaluation is read-only and produces structural top-level and reply candidates, safe visible control labels, a comment-container scroll observation, and the platform end signal.
7. Use the exact visible text of each approved reply-expansion label with `expandExactLabel`. Approved labels include `展开更多`, `展开 N 条回复`, `查看更多回复`, and `查看全部 N 条回复`. Never click `收起`, `展开全文`, product, detail, or shared CSS-class controls. The adapter uses `root.getByText(label, { exact: true })`, confirms the unique root, and clicks matching controls bottom-up. It rereads the control text immediately before each click, skipping an element that has changed to `收起` after a nested control expanded.
8. Add a tab cleanup guard around risky clicks:
   - Record the task tab id and a before snapshot with `browser.tabs.list()` before clicking expand controls or comment-area elements.
   - After each click batch, call `browser.tabs.list()` again and compare before and after.
   - If a new tab opened to a commenter profile, creator profile, `/user/` page, or any URL that is not the task detail URL, close the accidental tab and continue from the task tab.
   - If the task tab itself navigated away from the intended detail page, go back or reopen the normalized task URL before capturing.
9. In each round, build and save a `comment-dom-batch-v1` with `buildCommentDomBatch` and `writeCaptureArtifacts`. Then call `scrollCommentContainer(tab, profile)` so only Chrome CUA scrolls the observed comment container; do not mutate `scrollTop` through page evaluation and do not scroll the Douyin short-video feed. Save non-empty batches using the existing schema and paths:

```text
output/<project_id>/runs/<task_id>/
  capture-state.json
  batches/<batch_id>/comment-dom-batch.json
```

10. Each `comment-dom-batch.json` must stay compatible with `comment-dom-batch-v1` and include `candidate_id`, `candidate_hash`, `dom_path`, `role_hint`, `inner_text`, `html`, `nearby_buttons`, `rect`, and `captured_at` for candidates when available.
11. Update `capture-state.json` with `last_batch_id`, `next_batch_id`, seen candidate hashes, round counts, candidate totals, `declared_comment_count`, `captured_record_count`, `remaining_expand_count`, `end_signal`, and `count_gap`. QA records the displayed-versus-current-session rendered gap in notes without making that observation an issue by itself.
12. Stop after a scoped end signal, repeated idle rounds, navigation away, user-required verification, or configured runtime/batch limits. Close or finalize the task tab before moving to the next task.
13. For each batch, read `prompts/comment-candidate-batch-extraction.md` and `schemas/ai-comment-extraction.schema.json`.
14. Have AI output `batches/<batch_id>/ai-comment-extraction.json`, using `candidate_id` as `source_chunk_id`.
15. Normalize each batch:

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json \
  --batch output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json \
  --task output/<project_id>/runs/<task_id>/task.json \
  --out output/<project_id>/runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl
```

16. Merge task batches:

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/<project_id>/runs/<task_id>
```

### Weibo comment tasks: Chrome/model-only

Weibo comments are collected only through `chrome:control-chrome` from the user's logged-in, visible page and then structured by the model from saved candidates. The following Weibo rules override the general fallback section below: there is no MCP/API fallback for Weibo comments.

1. Load a validated explicit Weibo profile before any capture. It must identify exactly one comment root, sort scope, comment item selector, reply container, scroll container, and either DOM-ID or complete composite identity fields. Read only the explicit profile scope; never use a page-wide text lookup or invent a selector.
2. Within the unique sort scope, capture `按热度` first and verify the configured selected state. Safely expand only exact approved reply labels and scroll the observed comment container until the scoped stop condition. Then switch to `按时间`, verify its selected state, and repeat. Keep separate `streams.hot` and `streams.time` state in `capture-state.json`.
3. Every scroll window is a browser evidence-only `comment-dom-batch.json`; it is not a model request. Deduplicate candidates across windows and the two streams, then form model batches of at most 80 candidates/24,000 characters, whichever limit is reached first. Only model batches require `ai-comment-extraction.json`.
4. Preserve Chrome-read `source_comment_id`, `source_parent_comment_id`, and `source_root_comment_id` when available. If there is no stable comment ID, use only the complete deterministic public-DOM composite fingerprint. Composite-only capture is always `partial` and must never claim dual-sort all-complete, even when both streams reach page end.
5. Before each local Codex extraction call, generate `model-output-schema.json` from the canonical schema with `src/normalize/model-output-schema.js`; use that strict compatible clone for `--output-schema`. The model does not browse, click, sort, or supply identity fields.
6. On a login wall, CAPTCHA, verification, risk control, access limit, ambiguous root, failed sort verification, or incomplete safe reply expansion, stop and preserve the evidence as `partial` or `failed`. Ask the user to handle access checks; do not bypass them or substitute an interface/API source.

### MCP/CDP fallback

Use MCP/CDP only when Chrome extension control is unavailable, when the user explicitly requests the legacy path, or when debugging MCP capture behavior.

This MCP/CDP fallback does not apply to Weibo comment tasks: Weibo has no MCP/API fallback.

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

## 4. Merge, QA, And Build Excel

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

Generate the client workbook only after the completion gate passes. If the user explicitly requested smoke or sampling mode, you may generate the workbook as a test artifact, not a complete delivery:

```bash
python src/pipeline/build_client_comment_excel.py \
  --project-dir output/<project_id> \
  --template docs/michelin_kol_comments_all_platforms_0630.xlsx \
  --out output/<project_id>/delivery.xlsx
```

## 5. Resume Safely

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

## 6. Verification

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

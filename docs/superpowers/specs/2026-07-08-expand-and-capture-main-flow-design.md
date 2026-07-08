# Expand And Capture Main Flow Design

## Background

The current comment workflow separates expansion from DOM capture:

1. `expand_current_page_comments` runs the page expander until it stops.
2. `capture_comment_candidate_batch` or `capture_comment_candidate_batches_until_idle` captures the visible DOM afterward.

This loses coverage on virtualized comment lists. After expansion finishes, the page is often near the bottom, so the DOM only contains bottom comments. In the Michelin smoke test, task_0001 expanded thousands of raw candidates but the first DOM batch only captured the bottom visible area.

The new main flow will combine expansion, scrolling, and DOM capture in one loop.

## Goal

Make the skill default workflow use an MCP tool that captures DOM candidates while the page is being expanded and scrolled.

The first production profile is coverage-first with a balanced stop policy:

- Prioritize broad comment coverage.
- Stop after 8 idle rounds.
- Stop after 30 minutes.
- Keep per-batch payload bounded for AI extraction.
- Preserve resume and batch-level QA behavior.

## Non-Goals

- Do not ask AI to write Excel files directly.
- Do not move AI structure extraction into MCP.
- Do not replace batch normalization, task merge, project merge, QA, or Excel generation.
- Do not promise or implement behavior intended to bypass platform access controls. The pacing is for reliability and lower interaction intensity.

## New MCP Tool

Add a new tool:

```text
expand_and_capture_comment_batches
```

This becomes the default skill path for customer delivery projects.

It replaces this sequence:

```text
expand_current_page_comments
capture_comment_candidate_batches_until_idle
```

with:

```text
expand visible replies -> wait -> capture visible DOM -> save batch -> scroll -> wait -> repeat
```

The existing tools remain available for debugging and fallback:

- `expand_current_page_comments`
- `capture_comment_candidate_batch`
- `capture_comment_candidate_batches_until_idle`
- `capture_current_comment_dom_snapshot`

## Loop Design

Each round performs:

1. Find visible expand buttons in the current page or comment container.
2. Click at most `maxClicksPerRound` buttons.
3. Wait `expandWaitMs` with jitter.
4. Capture current visible DOM candidates before scrolling.
5. Deduplicate with previous candidate hashes.
6. Write a new batch only when there are new candidates, or when the final idle proof batch is useful for debugging.
7. Scroll the comment container by `scrollStepRatio` viewport height.
8. Wait `scrollWaitMs` with jitter.
9. Update `capture-state.json`.
10. Evaluate stop conditions.

The important ordering is:

```text
click -> wait -> capture -> save -> scroll -> wait
```

Capture happens before scroll because scrolling can cause virtualized lists to recycle the current DOM.

## Default Coverage Profile

```json
{
  "maxRuntimeMs": 1800000,
  "maxRounds": 800,
  "maxBatches": 300,
  "maxIdleRounds": 8,
  "maxClicksPerRound": 3,
  "expandWaitMsMin": 1000,
  "expandWaitMsMax": 1800,
  "scrollWaitMsMin": 1500,
  "scrollWaitMsMax": 2500,
  "scrollStepRatioMin": 0.55,
  "scrollStepRatioMax": 0.7,
  "maxCandidatesPerBatch": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true
}
```

The tool should accept overrides for these values. Defaults should be conservative enough for normal delivery runs.

## Stop Conditions

Stop reasons, in priority order:

1. `idle`: 8 consecutive rounds with no new candidates, no successful clicks, and no useful scroll progress.
2. `max-runtime`: 30 minutes elapsed.
3. `max-rounds`: round limit reached.
4. `max-batches`: batch limit reached.
5. `bottom-idle`: page appears bottomed out and idle for several rounds.
6. `manual`: future manual interruption hook.

The tool result must report:

- `stopReason`
- `roundCount`
- `batchCount`
- `candidateCount`
- `totalClicks`
- `idleRounds`
- `lastBatchId`
- `nextBatchId`
- `batchFiles`

## Output Files

The tool writes the same batch structure already used by the pipeline:

```text
output/<project_id>/runs/<task_id>/
  task.json
  capture-state.json
  batches/
    batch_0001/
      comment-dom-batch.json
    batch_0002/
      comment-dom-batch.json
```

AI extraction remains unchanged:

```text
batches/<batch_id>/ai-comment-extraction.json
batches/<batch_id>/normalized-comments.jsonl
runs/<task_id>/normalized-comments.jsonl
```

## Capture State

`capture-state.json` should continue to include existing fields and add run progress:

```json
{
  "schema_version": "capture-state-v1",
  "task_id": "task_0001",
  "platform": "douyin",
  "source_url": "https://...",
  "updated_at": "2026-07-08T00:00:00.000Z",
  "last_batch_id": "batch_0012",
  "next_batch_id": "batch_0013",
  "seen_candidate_hashes": [],
  "round": 48,
  "total_clicks": 122,
  "total_candidates": 864,
  "idle_rounds": 0,
  "stop_reason": "",
  "batches": []
}
```

Existing readers must keep working if these extra fields are present.

## Candidate Granularity

Coverage-first capture only helps if candidates are not too coarse.

The first implementation should keep existing selectors, but add one targeted improvement:

- Prefer smaller visible comment or reply nodes when a parent candidate contains multiple nested candidate nodes.
- Keep parent nodes only when no useful child candidate exists.

This reduces token cost and makes AI field splitting more reliable.

## Resume Behavior

When `capture-state.json` exists:

1. Read `next_batch_id`.
2. Read `seen_candidate_hashes`.
3. Continue from the current page position.
4. Do not overwrite existing batch directories.

If a rerun is created by `resume_comment_project.py`, write into the suggested rerun directory, preserving previous partial output.

## Skill Workflow Change

Update `comment-excel-delivery` so the default per-task browser step becomes:

```text
comment-crawler-v2.expand_and_capture_comment_batches
```

Then continue the existing steps:

1. AI reads each `comment-dom-batch.json`.
2. AI writes `ai-comment-extraction.json`.
3. `normalize-ai-comment-extraction.js` writes batch JSONL.
4. `merge_task_batches.py` writes task JSONL.
5. `merge_comment_runs.py`, QA, batch summary, and Excel generation run unchanged.

The old expand-then-capture path should be documented as fallback/debug only.

## Error Handling

- If the page host is unsupported, fail before injecting scripts.
- If login wall is detected by the existing expander signals, return a clear login error.
- If a round throws during click or capture, increment `totalErrors`, record a warning, and continue until the error threshold is reached.
- If CDP disconnects, fail the tool without writing a partial corrupt batch.
- If a batch write fails, stop and return the failing path.

## Testing

Add focused Node tests:

1. Tool is listed with expected input schema.
2. The loop writes multiple batch directories across rounds.
3. Capture occurs before scroll.
4. Idle stop triggers after 8 rounds without new candidates.
5. Runtime, max rounds, and max batches stop reasons are reported.
6. Existing `capture_comment_candidate_batch` behavior remains unchanged.
7. State resume uses `next_batch_id` and seen hashes.
8. Candidate granularity prefers child candidates over broad parent nodes.

Run existing Python tests because pipeline QA and resume consume the same batch output:

```bash
src/pipeline/.venv/bin/python -m unittest discover -s test/pipeline
```

Run Node tests:

```bash
node --test --test-reporter=dot test/*.test.js
```

## Acceptance Criteria

1. The new MCP tool writes multiple bounded batch files during one page run.
2. The default skill workflow uses the new tool as the main path.
3. A large Douyin task no longer captures only bottom-of-page DOM after expansion.
4. `batch-summary.json` can locate pending AI or normalization work per batch.
5. `resume-plan.json` still identifies partial, failed, and rerunnable tasks.
6. `delivery.xlsx` generation remains unchanged after normalized comments exist.
7. Existing debug tools remain callable.

## Implementation Order

1. Add tests for the new MCP tool and loop ordering.
2. Extract or reuse single-round expand helpers from the browser expander.
3. Implement `expand_and_capture_comment_batches`.
4. Improve candidate granularity.
5. Update `comment-excel-delivery` workflow and usage docs.
6. Run MCP smoke test on one Douyin task.
7. Run pipeline smoke to generate `delivery.xlsx`.

## Self-Review

- No unresolved markers are left in the design.
- The loop order is explicit and matches the coverage-first goal.
- The new tool does not move AI or Excel generation into MCP.
- Resume, QA, and existing batch pipeline outputs remain compatible.
- The first implementation scope is small enough for a single staged development pass.

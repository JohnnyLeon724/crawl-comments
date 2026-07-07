# Douyin Comment Expander v1 Design

Date: 2026-07-07

## Goal

Build a first-version browser Console script that quickly expands comments and replies on a Douyin page, scrolls through lazy-loaded content, and keeps a structured list of candidate comments found in the DOM. It does not classify sentiment or perform final business cleaning.

## Scope

- Target site: Douyin comment pages first.
- Delivery format: one JavaScript file that can be pasted directly into Chrome DevTools Console.
- Input: the currently open Douyin page with the user already logged in if needed.
- Output: progress logs, expanded comments in the page DOM, and candidate comment results available through `window.__commentExpanderV1.getResults()` or downloadable as JSON/CSV.

Out of scope for v1:

- Chrome extension packaging.
- Codex-controlled browser loops.
- AI sentiment analysis or final business cleaning.
- Weibo comment fetching, which should continue to use the API-first workflow described in `tcl_weibo_comment_workflow_rules_2026-07-07.md`.

## Approach

The script runs inside the page and handles high-frequency browser actions locally:

1. Scan buttons for Douyin-style expand labels such as `展开更多`, `展开更多回复`, `展开3条回复`, and `展开3回复`.
2. Click all eligible visible expand buttons in small batches.
3. Scroll the most likely comment container, falling back to the page scroller.
4. Use DOM mutation counts and scroll-position changes to detect whether new content is still loading.
5. Extract comment-like DOM blocks during each round, strip common UI suffixes, and dedupe by normalized text.
6. Stop after several idle rounds where no new buttons are clicked, no DOM nodes are added, no comments are added, and scrolling no longer changes the view.

## Components

- Button matcher: recognizes expand/reply labels.
- Element utilities: normalize text, detect visibility, build a stable-ish DOM key.
- Candidate selector: filters disabled, hidden, already retried, and duplicate buttons.
- Click helper: dispatches pointer and mouse events before calling `click()`.
- Scroll helper: finds a scrollable comment container and advances it.
- Extractor: gathers visible comment-like blocks, infers `level1`/`level2`, strips UI text, and stores DOM paths.
- Run loop: alternates batch clicking, waiting, scrolling, extraction, and idle detection.
- Stop handle: exposes `window.__commentExpanderV1.stop()` for manual cancellation.
- Result handle: exposes `getResults()`, `getPayload()`, `downloadJson()`, and `downloadCsv()` for Codex/Chrome or manual use.

## Configuration

The script should expose conservative defaults:

- `maxRuntimeMs`: 10 minutes.
- `maxClicks`: 3000.
- `maxRounds`: 1000.
- `maxIdleRounds`: 8.
- `batchSize`: 8.
- `clickGapMs`: 120.
- `afterBatchWaitMs`: 800.
- `scrollWaitMs`: 900.
- `maxRetryPerButton`: 3.
- `extractComments`: true.

Users can edit these constants at the top of the file before pasting.

## Error Handling

- If a click fails, record a warning and continue.
- If the script is already running, stop the previous run before starting a new one.
- If no comment-specific scroll container is found, scroll the document.
- If the page blocks synthetic clicks, the script still logs which buttons were found so the selector logic can be revised.
- If extraction captures extra UI text, treat the output as candidate comments and tighten the extractor or add a site adapter.

## Testing

Automated tests cover pure logic that can run in Node without browser dependencies:

- Expand-button text recognition.
- Visible and retry-aware candidate filtering.
- DOM path/key generation for retry tracking.
- Idle-stop condition.
- Scroll container scoring.
- Comment-like block extraction and CSV formatting.

Manual verification is still required on a real Douyin page because the live site controls DOM structure, lazy loading, and anti-automation behavior.

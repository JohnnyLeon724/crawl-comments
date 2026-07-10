# Safe Chrome Comment Capture Design

## Context

The current default Chrome guidance can select controls by broad text or shared CSS classes. On the Douyin detail page used for validation, “展开更多” and “收起” shared a class. A class-wide batch action therefore collapsed comment threads that had just been expanded.

The replacement makes this validated sequence the default:

1. discover exact expansion controls;
2. expand only those controls;
3. verify the resulting page state;
4. capture scoped comment records;
5. scroll only the comment container;
6. stop at a reliable end signal and report any count discrepancy.

## Goals

- Never click a control whose rendered text is “收起” or another collapse action.
- Limit expansion actions to exact, user-visible reply-expansion labels.
- Capture top-level comments and replies from a scoped comment root rather than page-wide text.
- Preserve the existing batch artifacts and downstream Excel pipeline.
- Report the difference between a platform-declared comment count and records that the current session could actually read.
- Keep MCP/CDP and the standalone legacy crawler as fallback paths.

## Non-goals

- Bypass login, CAPTCHA, verification, consent, or platform access controls.
- Infer or fetch comments that the platform does not render to the logged-in session.
- Replace the existing parsing, AI extraction, normalization, QA, resume, or Excel-generation commands.
- Change the customer workbook schema.

## Chosen Architecture

Add a Chrome-session adapter at src/browser/chrome-comment-capture.js. It is a small orchestration layer designed to be imported into the Chrome Node session after the Chrome skill has initialized the browser binding.

The adapter has four focused responsibilities:

| Component | Responsibility |
| --- | --- |
| discoverExpandControls | Read the scoped comment root and return only visible controls whose rendered text matches an approved expansion label. |
| expandExactControls | For one exact label at a time, count the matching locator, click resolved controls bottom-up, then re-observe state. It never selects by a shared class and never targets collapse text. |
| captureCommentRecords | Read the identified comment root and project direct comment/reply records with stable DOM metadata, candidate hashes, and parent/reply relation. |
| scrollCommentContainer | Read candidate scroll containers, select the comment-specific container, scroll with Chrome CUA, and verify the scroll position changed. |

The adapter returns a serializable capture state. A thin project-run wrapper writes that state and the existing comment-dom-batch-v1 artifact paths. The browser itself is controlled only through the Chrome runtime; page evaluation remains read-only.

## Expansion Rules

Discovery starts from the known comment root and considers only visible interactive elements. It normalizes visible text and accepts these label families:

- 展开更多
- 展开更多回复
- 展开 N 条回复
- 查看更多回复
- 查看全部 N 条回复

It rejects 收起, 展开全文, generic content expansion, shopping/detail controls, disabled controls, and controls outside the comment root.

For each exact discovered label:

1. obtain a locator with that exact text;
2. count it before clicking;
3. resolve the current matches;
4. click from bottom to top so inserted replies do not shift the remaining targets;
5. read the remaining exact-label count and captured-comment count.

The next round rediscovers controls from the live DOM. It does not reuse a class selector or a stale list across rounds.

## Capture And Completion Rules

Each round captures the scoped comment root before scrolling. A record is classified as a top-level comment or reply from structural parentage, not only from textual keywords. The batch preserves the existing candidate schema and includes the structural relation in role_hint or extraction context.

The state records:

- declared_comment_count when the page exposes one;
- captured_record_count;
- remaining_expand_count;
- scroll_top, scroll_height, and client_height;
- end_signal such as 暂时没有更多评论;
- count_gap when the declared and captured counts differ;
- stop_reason.

Completion requires no remaining approved expansion labels and a reliable idle or end-of-comments signal. A non-zero count_gap is not silently treated as full capture: it is carried into task QA and the final delivery report as a platform-rendering discrepancy. The task may be marked blocked/partial only when the pipeline cannot obtain enough records and needs user action or a resumed run.

## Documentation And Migration

The following become the canonical Chrome workflow:

- .codex/skills/comment-excel-delivery/SKILL.md
- .codex/skills/comment-excel-delivery/references/workflow.md
- docs/comment-crawler-mcp-usage.md

The old generic Chrome snippet is removed. Documentation will call the new adapter and describe its exact-label, re-observe, scoped-capture, and count-gap rules. MCP/CDP remains explicitly documented as fallback.

## Testing

Add focused Node tests for:

- accepting expansion labels and rejecting collapse labels even when they share a class;
- exact-label expansion that avoids stale controls after DOM changes;
- bottom-up ordering;
- scoped comment/reply extraction and deduplication;
- comment-container selection rather than page/feed scrolling;
- end-signal and count-gap reporting.

Update documentation and skill tests so they assert the safe Chrome workflow is canonical and the old broad selector example is absent. Run the existing Node and Python suites after implementation.

## Rollout

1. Add the adapter and tests.
2. Replace the Chrome workflow documentation and skill instructions.
3. Run targeted tests, then the full relevant Node and Python suites.
4. Use the next real Chrome capture as an operational smoke check, preserving a count-gap report when the platform display and rendered DOM differ.

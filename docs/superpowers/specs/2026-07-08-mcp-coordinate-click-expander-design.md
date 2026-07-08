# MCP Coordinate Click Expander Design

Date: 2026-07-08

## Background

The current production path is `comment-crawler-v2.expand_and_capture_comment_batches`.
It already combines reply expansion, DOM candidate capture, scrolling, dedupe, and idle stop.

The weak point is the expansion click itself. The current MCP implementation finds visible
expand controls in `page.evaluate(...)` and clicks them with DOM-level `el.click()`. This works
on many pages, but it is less faithful to real browser input than the Chrome plugin workflow
tested on Douyin, where Codex used:

```text
tab.cua.click({ x, y })
```

That Chrome-plugin path clicked real viewport coordinates and successfully expanded replies
on the current Douyin page.

## Goal

Upgrade the MCP production workflow so the default expansion behavior uses coordinate-level
mouse input, with DOM click retained as a fallback.

The goal is better interaction compatibility and a steadier production crawl loop:

- Click only visible expand controls.
- Click by viewport coordinates inside the target element.
- Add modest mouse movement and timing variation.
- Continue to capture DOM batches before scrolling.
- Preserve the existing output layout, resume behavior, and Excel pipeline.

## Non-Goals

- Do not implement or describe techniques intended to bypass platform access controls.
- Do not promise that coordinate clicks reduce platform risk.
- Do not solve CAPTCHA, login walls, or account verification.
- Do not move AI semantic extraction into MCP.
- Do not replace the current JSONL, QA, resume, or Excel generation pipeline.

If the page shows login, CAPTCHA, verification, access restrictions, or abnormal prompts, the
tool should stop with a clear reason rather than trying to continue.

## Design Choice

Use a configurable click mode:

```json
{
  "clickMode": "coordinate"
}
```

Supported values:

- `coordinate`: default production mode. Find targets in the page, then click their coordinates
  from the MCP host using Playwright mouse APIs or raw CDP input events.
- `dom-click`: legacy fallback. Use the existing in-page `el.click()` strategy.
- `auto`: try coordinate first, then fall back to `dom-click` for the current round if coordinate
  input is unavailable.

Recommended default:

```json
{
  "clickMode": "coordinate",
  "fallbackClickMode": "dom-click"
}
```

## Component Boundaries

### `findVisibleExpandTargets(page, options)`

Runs inside the page and returns data only. It must not click.

Responsibilities:

- Match expand labels such as:
  - `展开更多`
  - `展开更多回复`
  - `展开5条回复`
  - `查看更多回复`
  - `查看5条回复`
- Reject labels such as:
  - `展开全文`
  - `收起`
  - product/detail buttons
- Confirm visibility and enabled state.
- Prefer the innermost clickable expand control to avoid duplicate parent/child targets.
- Return bounded target records:

```json
{
  "text": "展开5条回复",
  "dom_path": "HTML:nth-of-type(1)>...",
  "rect": { "left": 217, "top": 357, "width": 1141, "height": 20 },
  "center": { "x": 314, "y": 367 },
  "click_point": { "x": 318, "y": 366 }
}
```

The `click_point` should be inside the visible rect and include a small bounded offset. It should
not always be the exact center.

### `clickExpandTargets(page, targets, options)`

Runs in MCP host code. It performs input events.

Responsibilities:

- Click at most `maxClicksPerRound`.
- Move the mouse to the target with a small number of steps.
- Press and release with a short configurable hold.
- Wait between clicks with bounded jitter.
- Record per-target click result and error text.

For normal Playwright CDP sessions:

```text
page.mouse.move(x, y, { steps })
page.mouse.down()
wait clickDownMs
page.mouse.up()
```

For raw CDP fallback sessions:

```text
Input.dispatchMouseEvent mouseMoved
Input.dispatchMouseEvent mousePressed
Input.dispatchMouseEvent mouseReleased
```

If neither input path is available, the round should fall back to `dom-click` when configured.

### `expandVisibleCommentsOnce(page, options)`

Becomes an orchestrator:

```text
targets = findVisibleExpandTargets(page)
if clickMode == coordinate:
  result = clickExpandTargets(page, targets)
  if failed and fallbackClickMode == dom-click:
    result = domClickExpandTargets(page, targets)
else:
  result = domClickExpandTargets(page, targets)
return summary
```

It should keep its existing public behavior:

```json
{
  "clicked": 3,
  "errors": 0,
  "available": 3
}
```

It may add optional fields:

```json
{
  "click_mode": "coordinate",
  "fallback_used": false,
  "targets": []
}
```

## Default Interaction Profile

Add conservative defaults to the existing expand-and-capture config:

```json
{
  "clickMode": "coordinate",
  "fallbackClickMode": "dom-click",
  "clickJitterPx": 4,
  "mouseMoveStepsMin": 4,
  "mouseMoveStepsMax": 9,
  "clickDownMsMin": 60,
  "clickDownMsMax": 160,
  "clickGapMsMin": 300,
  "clickGapMsMax": 900
}
```

These values are for interaction stability, not for evading detection.

## Loop Integration

The existing `expand_and_capture_comment_batches` ordering remains:

```text
click visible expand controls
wait expandWaitMs
capture visible DOM candidates
save non-empty batch
scroll comment container
wait scrollWaitMs
update capture-state.json
evaluate stop conditions
```

Only the click implementation changes. Capturing before scrolling remains required because
virtualized lists may recycle DOM nodes after scroll.

## State And Observability

`capture-state.json` should retain existing fields and may add:

```json
{
  "click_mode": "coordinate",
  "fallback_click_count": 0,
  "coordinate_click_count": 122,
  "dom_click_count": 0,
  "last_click_errors": []
}
```

The MCP tool result may add the same aggregate fields.

Per-target logs should stay bounded. Store a recent tail, not every click forever, to keep state
files readable.

## Safety And Stop Conditions

The tool should stop or return a clear failure when it detects:

- Login wall.
- CAPTCHA or verification prompt.
- Page closed.
- Unsupported browser control path.
- Repeated click failures with no DOM changes.

Stop reasons to add:

- `verification-required`
- `login-required`
- `click-input-unavailable`
- `click-failed-idle`

Existing stop reasons remain valid:

- `idle`
- `max-runtime`
- `max-rounds`
- `max-batches`

## Testing Plan

Unit tests:

- Expand target matcher accepts Douyin and Xiaohongshu labels.
- Matcher rejects `展开全文`, `收起`, product/detail controls, and duplicate parent targets.
- Click point generation stays inside the target rect.
- Mouse profile normalization clamps invalid ranges.
- `coordinate` mode calls mouse APIs when available.
- `auto` mode falls back to DOM click when mouse APIs are unavailable.
- Raw CDP input dispatch builds `mouseMoved`, `mousePressed`, and `mouseReleased` events.
- `capture-state.json` preserves existing readers when new click fields are present.

Integration smoke tests:

- MCP status exposes the unchanged tool name `expand_and_capture_comment_batches`.
- A mocked page with expand buttons produces clicks, captures batches, scrolls, and stops.
- A mocked raw CDP page without Playwright mouse support falls back correctly.

Manual tests:

- Douyin page with replies: coordinate mode expands visible replies and reaches bottom.
- Xiaohongshu page with replies: coordinate mode expands visible replies and reaches bottom.
- Login wall: tool stops with `login-required`.
- Verification prompt: tool stops with `verification-required`.

## Skill Impact

`comment-excel-delivery` should continue to call:

```text
comment-crawler-v2.expand_and_capture_comment_batches
```

The skill documentation should mention that production default click mode is coordinate input,
with DOM click fallback. Chrome plugin collection remains a debugging or emergency fallback when
the user explicitly wants Codex to operate the currently open browser tab.

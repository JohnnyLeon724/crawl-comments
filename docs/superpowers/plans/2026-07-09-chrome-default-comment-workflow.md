# Chrome Default Comment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the comment delivery documentation so `chrome:control-chrome` is the default browser workflow while the existing MCP/CDP path remains a fallback.

**Architecture:** This is a documentation-contract change guarded by tests. Python tests protect the `comment-excel-delivery` skill and workflow reference; a Node documentation test protects the project usage guide. No crawler, MCP, normalizer, merge, QA, or Excel generator code changes.

**Tech Stack:** Markdown, Python `unittest`, Node `node:test`, existing comment pipeline artifact names.

## Global Constraints

- Documentation-only for this iteration.
- Chrome is the default main workflow.
- MCP/CDP is fallback and legacy debugging guidance.
- Update both `.codex/skills/comment-excel-delivery/` and `docs/comment-crawler-mcp-usage.md`.
- The skill stays concise and mandatory; the docs carry longer examples and troubleshooting.
- Outputs remain fully compatible with the current pipeline.
- Codex automation is preferred for page opening, clicking, scrolling, DOM capture, and tab cleanup.
- Login, CAPTCHA, verification, or platform access checks must pause for user action and must not be bypassed.
- Do not implement a new CLI.
- Do not add or modify MCP tools.
- Do not modify pipeline Python scripts.
- Do not change `comment-dom-batch-v1`, `ai-comment-extraction-v1`, or normalized comment JSONL shape.
- Do not create Chrome-specific artifact names such as `chrome-dom-batch.json`.

---

## File Structure

- Modify `.codex/skills/comment-excel-delivery/SKILL.md`: declare the Chrome skill as the default browser execution surface and demote MCP/CDP to fallback/debug.
- Modify `.codex/skills/comment-excel-delivery/references/workflow.md`: rewrite the per-task workflow as Chrome-first while keeping AI, normalize, merge, QA, resume, and Excel commands unchanged.
- Modify `docs/comment-crawler-mcp-usage.md`: reframe as a Chrome-default capture guide with a longer Chrome example and a fallback MCP/CDP section.
- Modify `test/pipeline/test_comment_excel_delivery_skill.py`: add Python documentation contract tests for the skill and workflow.
- Modify `test/comment-crawler-mcp-usage-doc.test.js`: add Node documentation contract tests for the project usage guide.

---

### Task 1: Guard And Update The Skill Workflow

**Files:**
- Modify: `test/pipeline/test_comment_excel_delivery_skill.py`
- Modify: `.codex/skills/comment-excel-delivery/SKILL.md`
- Modify: `.codex/skills/comment-excel-delivery/references/workflow.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-09-chrome-default-comment-workflow-design.md`
- Produces: Skill and workflow documentation that says Chrome is default, MCP/CDP is fallback, and existing artifact paths remain unchanged.

- [ ] **Step 1: Write the failing Python documentation tests**

In `test/pipeline/test_comment_excel_delivery_skill.py`, keep the existing imports and class, then add these methods inside `CommentExcelDeliverySkillTest`:

```python
    def test_skill_declares_chrome_as_default_browser_workflow(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "chrome:control-chrome",
            "default browser execution surface",
            "MCP/CDP",
            "fallback",
            "comment-dom-batch.json",
            "ai-comment-extraction.json",
            "normalized-comments.jsonl",
        ]:
            self.assertIn(text, skill + "\n" + workflow)

        self.assertRegex(
            skill,
            r"(?is)default browser execution surface.*chrome:control-chrome",
        )
        self.assertRegex(
            workflow,
            r"(?is)Chrome default per-task workflow.*Open a fresh tab",
        )
        self.assertRegex(
            workflow,
            r"(?is)login.*CAPTCHA.*verification.*user action",
        )

    def test_mcp_cdp_is_documented_as_fallback_not_default(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("MCP/CDP fallback", workflow)
        self.assertIn("expand_and_capture_comment_batches", workflow)
        self.assertIn("capture_comment_candidate_batch", workflow)
        self.assertIn("capture_comment_candidate_batches_until_idle", workflow)
        self.assertNotRegex(
            workflow,
            r"Use `expand_and_capture_comment_batches` as the default comment browser step",
        )
```

Replace the existing `test_comment_excel_delivery_documents_coordinate_click_mode` method with this fallback-specific version:

```python
    def test_workflow_keeps_mcp_coordinate_click_details_in_fallback_section(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("Coordinate clicking remains the MCP fallback production interaction mode", workflow)
        self.assertIn('"clickMode": "coordinate"', workflow)
        self.assertIn('"fallbackClickMode": "dom-click"', workflow)
        self.assertIn('"sourceUrl": "<task.source_url>"', workflow)
        self.assertIn('"postClickWaitMsMin": 800', workflow)
        self.assertIn('"postClickWaitMsMax": 1600', workflow)
```

- [ ] **Step 2: Run the Python test and verify RED**

Run:

```bash
python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: FAIL. The failure must mention missing `chrome:control-chrome`, missing `Chrome default per-task workflow`, or the old default MCP sentence still being present.

- [ ] **Step 3: Update the skill summary**

In `.codex/skills/comment-excel-delivery/SKILL.md`, replace the fixed responsibility bullet that currently says MCP/browser tools are the default browser step with this exact text:

```markdown
- Chrome is the default browser execution surface. Use `chrome:control-chrome` to operate the user's logged-in Chrome session: open a fresh task tab, expand visible comments and replies, scroll, capture bounded DOM candidate batches, and close/finalize the tab after the task.
- MCP/CDP tools remain fallback/debug paths for reproducing legacy behavior, comparing candidate capture, or continuing when Chrome extension control is unavailable.
```

In the Operating Rules section, add this rule immediately after rule 1 and renumber the remaining rules:

```markdown
2. For browser capture, default to `chrome:control-chrome`. Pause for user action when login, CAPTCHA, verification, or platform access checks appear; do not bypass them or substitute another source.
```

In the Expected Outputs section, keep every existing output bullet. Do not add `chrome-dom-batch.json`.

- [ ] **Step 4: Rewrite the workflow per-task section as Chrome-first**

In `.codex/skills/comment-excel-delivery/references/workflow.md`, replace the entire `## 2. Run One Task` section through the end of its `Fallback/debug path:` list with this content:

```markdown
## 2. Run One Task

For each `runs/<task_id>/task.json`, use `chrome:control-chrome` as the default browser execution surface.

### Chrome default per-task workflow

1. Connect to Chrome through the Chrome skill and use the user's logged-in Chrome session.
2. Open a fresh tab for `task.source_url`; do not manually reuse an old content tab as the task target.
3. Confirm the current page is the intended Douyin or Xiaohongshu target. If login, CAPTCHA, verification, privacy consent, or platform access checks appear, pause and ask the user to handle them. Do not bypass the check or replace the platform page with another source.
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
```

- [ ] **Step 5: Run the Python test and verify GREEN**

Run:

```bash
python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: PASS with output ending in `OK`.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add test/pipeline/test_comment_excel_delivery_skill.py .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md
git commit -m "docs: make chrome default in delivery skill"
```

Expected: commit succeeds and includes only these three files.

---

### Task 2: Guard And Update The Project Usage Guide

**Files:**
- Modify: `test/comment-crawler-mcp-usage-doc.test.js`
- Modify: `docs/comment-crawler-mcp-usage.md`

**Interfaces:**
- Consumes: Skill workflow language from Task 1.
- Produces: Project documentation that explains Chrome-first capture, compatible batch output, AI extraction, normalizer commands, and MCP/CDP fallback.

- [ ] **Step 1: Replace the Node documentation test with Chrome-first assertions**

Replace the contents of `test/comment-crawler-mcp-usage-doc.test.js` with:

```javascript
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const docPath = path.join(__dirname, '..', 'docs', 'comment-crawler-mcp-usage.md');

test('usage documentation describes the Chrome default workflow', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const requiredText of [
    'Chrome default comment capture workflow',
    'chrome:control-chrome',
    'default browser execution surface',
    'fresh tab',
    'tab.playwright',
    'comment-dom-batch-v1',
    'comment-dom-batch.json',
    'capture-state.json',
    'ai-comment-extraction.json',
    'normalized-comments.jsonl',
    'comment-candidate-batch-extraction.md',
    '--batch',
    'merge_task_batches.py'
  ]) {
    assert.match(doc, new RegExp(requiredText));
  }
});

test('usage documentation keeps MCP as fallback and blocks verification bypasses', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const requiredText of [
    'MCP/CDP fallback',
    'expand_and_capture_comment_batches',
    'capture_comment_candidate_batch',
    'capture_comment_candidate_batches_until_idle',
    'closePageAfter',
    'login',
    'CAPTCHA',
    'verification',
    'user action',
    'Do not bypass'
  ]) {
    assert.match(doc, new RegExp(requiredText));
  }
});
```

- [ ] **Step 2: Run the Node documentation test and verify RED**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js
```

Expected: FAIL. The failure must mention at least one missing Chrome-first text such as `Chrome default comment capture workflow`, `chrome:control-chrome`, or `tab.playwright`.

- [ ] **Step 3: Reframe the project usage guide heading and opening sections**

In `docs/comment-crawler-mcp-usage.md`, replace the title and the current sections `## 1. 当前能力` through `## 4. 推荐调用顺序` with the following content:

````markdown
# Chrome default comment capture workflow

更新时间：2026-07-09

## 1. Default workflow

Chrome is the default browser execution surface for comment capture. Use `chrome:control-chrome` when a task depends on the user's logged-in Chrome session, visible platform state, or browser extension control.

The default flow is:

1. Parse task links into `output/<project_id>/crawl-tasks.json`.
2. Use `chrome:control-chrome` to open each `task.source_url` in a fresh tab.
3. Let Codex automate visible comment expansion, reply expansion, scrolling, and DOM inspection through Chrome.
4. Stop for user action when login, CAPTCHA, verification, privacy consent, or platform access checks appear. Do not bypass those checks.
5. Save visible DOM candidates as `comment-dom-batch-v1` files under the existing batch paths.
6. Run AI extraction, normalization, task merge, project merge, QA, and Excel generation with the existing commands.

## 2. Chrome per-task sequence

For each task directory:

```text
output/<project_id>/runs/<task_id>/
  task.json
```

Run the browser part in a fresh Chrome tab:

1. Connect to Chrome using the `chrome:control-chrome` skill.
2. Open a new tab and navigate to `task.source_url`.
3. Confirm that the current page is the intended Douyin or Xiaohongshu page.
4. If login, CAPTCHA, verification, or consent UI appears, pause and ask the user to complete it in Chrome.
5. Click visible expand controls such as `展开更多`, `展开 N 条回复`, comments, or replies.
6. Capture the current visible comment candidate DOM before scrolling.
7. Scroll the comment area and repeat bounded rounds until idle, navigation away, verification, or configured limits.
8. Close or finalize the task tab before moving to the next task.

## 3. Chrome DOM batch shape

Chrome capture must write the same artifacts consumed by the existing pipeline:

```text
output/<project_id>/runs/<task_id>/
  capture-state.json
  batches/
    batch_0001/
      comment-dom-batch.json
    batch_0002/
      comment-dom-batch.json
```

Each `comment-dom-batch.json` must use `comment-dom-batch-v1` and preserve candidate fields used by AI extraction:

```json
{
  "schema_version": "comment-dom-batch-v1",
  "batch_id": "batch_0001",
  "task_id": "task_0001",
  "platform": "douyin",
  "source_url": "https://example.invalid/video/123",
  "captured_at": "2026-07-09T00:00:00.000Z",
  "scroll": {},
  "state": {
    "new_candidate_count": 1,
    "has_more": false
  },
  "limits": {
    "maxCandidates": 80,
    "maxCharsPerCandidate": 2500
  },
  "candidates": [
    {
      "candidate_id": "candidate_000001",
      "candidate_hash": "sha1-value",
      "dom_path": "body > div:nth-child(1)",
      "role_hint": "comment_candidate",
      "inner_text": "用户A 评论正文 1周前·北京 3 分享 回复",
      "html": "<div>用户A 评论正文</div>",
      "nearby_buttons": ["用户A", "回复"],
      "rect": {"x": 0, "y": 0, "width": 320, "height": 80},
      "captured_at": "2026-07-09T00:00:00.000Z"
    }
  ]
}
```

Do not create Chrome-specific artifact names such as `chrome-dom-batch.json`.

## 4. Chrome control example

The exact Chrome API is provided by the `chrome:control-chrome` skill. A production run must read that skill first. The browser client exposes Playwright-compatible page access through `tab.playwright`; use that surface to inspect, click, scroll, and extract bounded DOM candidates.

```javascript
const tab = await browser.tabs.new();
await tab.goto(task.source_url);

const page = tab.playwright;
await page.waitForLoadState('domcontentloaded');

const blockedText = await page.locator('body').innerText({ timeout: 5000 });
if (/登录|验证码|CAPTCHA|验证|隐私|同意/.test(blockedText)) {
  throw new Error('Page requires user action for login, CAPTCHA, verification, or consent.');
}

for (const label of ['展开更多', '展开回复', '查看更多回复']) {
  const buttons = await page.getByText(label, { exact: false }).all();
  for (const button of buttons.slice(0, 3)) {
    await button.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(900);
  }
}

const candidates = await page.locator('[data-e2e*="comment"], [class*="comment"], [class*="reply"]').evaluateAll(nodes =>
  nodes.slice(0, 80).map((node, index) => {
    const rect = node.getBoundingClientRect();
    return {
      candidate_id: `candidate_${String(index + 1).padStart(6, '0')}`,
      candidate_hash: '',
      dom_path: node.tagName.toLowerCase(),
      role_hint: /reply/i.test(node.className) ? 'reply_candidate' : 'comment_candidate',
      inner_text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500),
      html: (node.outerHTML || '').slice(0, 2500),
      nearby_buttons: Array.from(node.querySelectorAll('button,a')).slice(0, 8).map(item => (item.innerText || '').trim()).filter(Boolean),
      rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
      captured_at: new Date().toISOString()
    };
  }).filter(item => item.inner_text)
);

await page.mouse.wheel(0, Math.round(await page.evaluate(() => window.innerHeight * 0.75)));
await page.waitForTimeout(1200);
```

This example demonstrates the expected Chrome control pattern. The saved file still must be a valid `comment-dom-batch-v1` batch with stable candidate hashes and capture state.

## 5. AI extraction and normalization
````

- [ ] **Step 4: Keep and update the AI extraction and normalization content**

Under the new `## 5. AI extraction and normalization` heading in `docs/comment-crawler-mcp-usage.md`, keep or add this content:

````markdown
For each batch, read:

```text
prompts/comment-candidate-batch-extraction.md
output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json
```

AI writes:

```text
output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json
```

The AI output must use `candidate_id` as `source_chunk_id`.

Normalize one batch:

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/<project_id>/runs/<task_id>/batches/<batch_id>/ai-comment-extraction.json \
  --batch output/<project_id>/runs/<task_id>/batches/<batch_id>/comment-dom-batch.json \
  --task output/<project_id>/runs/<task_id>/task.json \
  --out output/<project_id>/runs/<task_id>/batches/<batch_id>/normalized-comments.jsonl
```

Merge one task:

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/<project_id>/runs/<task_id>
```
````

- [ ] **Step 5: Add an MCP/CDP fallback section**

After the AI extraction section in `docs/comment-crawler-mcp-usage.md`, add this section before any remaining legacy MCP detail:

````markdown
## 6. MCP/CDP fallback

MCP/CDP fallback remains available for legacy reproduction, MCP debugging, or runs where Chrome extension control is unavailable. It is not the default browser execution surface.

Fallback tools:

| 工具 | 用途 | 输出 |
|---|---|---|
| `get_comment_crawler_status` | 检查 MCP server 状态 | server 版本、项目目录 |
| `expand_and_capture_comment_batches` | Fallback main flow: expand visible replies, capture DOM candidates before scrolling, and save bounded batches | `batches/<batch_id>/comment-dom-batch.json`, `capture-state.json` |
| `capture_comment_candidate_batch` | Capture one visible candidate batch from the current page | `batches/<batch_id>/comment-dom-batch.json`, `capture-state.json` |
| `capture_comment_candidate_batches_until_idle` | Capture batches until idle without the full expand loop | multiple batch directories |
| `expand_current_page_comments` | Legacy expand-only path | page expander summary |
| `capture_current_comment_dom_snapshot` | Small-page/debug DOM snapshot | `comment-dom-snapshot.json` |
| `save_current_page_comments` | Save legacy raw comments payload | `raw-comments.json` |
| `normalize_comment_run` | Normalize legacy raw output | `normalized-comments.jsonl` |

Fallback main call:

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
  "postClickWaitMsMin": 800,
  "postClickWaitMsMax": 1600,
  "closePageAfter": true
}
```

Do not bypass login, CAPTCHA, verification, or platform access checks in fallback mode. Stop and ask for user action.
````

- [ ] **Step 6: Run the Node documentation test and verify GREEN**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js
```

Expected: PASS with dot reporter showing no failures.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add test/comment-crawler-mcp-usage-doc.test.js docs/comment-crawler-mcp-usage.md
git commit -m "docs: add chrome default comment capture guide"
```

Expected: commit succeeds and includes only these two files.

---

### Task 3: Full Verification And Final Review

**Files:**
- Review: `.codex/skills/comment-excel-delivery/SKILL.md`
- Review: `.codex/skills/comment-excel-delivery/references/workflow.md`
- Review: `docs/comment-crawler-mcp-usage.md`
- Review: `test/pipeline/test_comment_excel_delivery_skill.py`
- Review: `test/comment-crawler-mcp-usage-doc.test.js`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 commits.
- Produces: verified documentation-only implementation ready for handoff.

- [ ] **Step 1: Run all required verification commands**

Run:

```bash
python -m unittest discover -s test/pipeline
node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js
git diff --check HEAD~2..HEAD
```

Expected:

```text
Python unittest output ends with OK.
Node test output reports zero failures.
git diff --check prints no output.
```

- [ ] **Step 2: Confirm documentation contract text is present**

Run:

```bash
rg -n "chrome:control-chrome|default browser execution surface|Chrome default per-task workflow|MCP/CDP fallback|comment-dom-batch.json|ai-comment-extraction.json|normalized-comments.jsonl|CAPTCHA|Do not bypass" .codex/skills/comment-excel-delivery docs/comment-crawler-mcp-usage.md
```

Expected: matches appear in the skill, workflow reference, and project documentation.

- [ ] **Step 3: Confirm no production code changed**

Run:

```bash
git show --stat --oneline HEAD~1..HEAD
git show --stat --oneline HEAD~2..HEAD
```

Expected: changed files are limited to Markdown docs and documentation tests. No files under `src/`, `mcp/`, `script/`, `adapters/`, or `clis/` appear.

- [ ] **Step 4: Prepare final summary**

Report:

```text
Updated Chrome to the default documented browser workflow.
Kept MCP/CDP as fallback.
Preserved existing batch and pipeline artifacts.
Verification run:
- python -m unittest discover -s test/pipeline
- node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js
```

Do not claim success unless the commands in Step 1 passed in the current run.

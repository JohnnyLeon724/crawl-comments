# Safe Chrome Comment Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace generic Chrome comment expansion with exact-label, scoped comment capture that cannot click collapse controls and that reports a platform-rendering count gap.

**Architecture:** Create a CommonJS adapter that accepts the Chrome skill's initialized tab object and an explicit platform profile. The adapter observes the unique comment root through read-only Playwright calls, expands only safe exact labels via scoped locators, scrolls through Chrome CUA, creates comment-dom-batch-v1 records, and writes capture-state.json. Extend QA to report the page's declared count versus the session-rendered count without making that discrepancy an issue by itself.

**Tech Stack:** Node.js CommonJS and node:test; JSON Schema; Python unittest; Markdown skill documentation.

## Global Constraints

- Initialize Chrome with chrome:control-chrome before importing the adapter.
- Use exact visible control text inside the unique comment root. Never use a shared CSS class as the click selector.
- Reject 收起, 展开全文, shopping, and detail controls.
- Page evaluation is read-only; click with scoped Playwright locators and scroll with tab.cua.
- Preserve comment-dom-batch-v1, existing normalized JSONL paths, and the current Excel pipeline.
- Treat MCP/CDP and the legacy crawler as fallback paths.
- Persist the rendered count gap in capture-state.json and QA notes without automatically changing an otherwise passing task to partial.

---

## File Structure

- Create: src/browser/chrome-comment-capture.js
- Create: test/chrome-comment-capture.test.js
- Modify: schemas/comment-dom-batch.schema.json
- Modify: test/comment-dom-batch-schema.test.js
- Modify: src/pipeline/qa_comment_delivery.py
- Modify: test/pipeline/test_qa_comment_delivery.py
- Modify: .codex/skills/comment-excel-delivery/SKILL.md
- Modify: .codex/skills/comment-excel-delivery/references/workflow.md
- Modify: docs/comment-crawler-mcp-usage.md
- Modify: test/pipeline/test_comment_excel_delivery_skill.py
- Modify: test/comment-crawler-mcp-usage-doc.test.js

## Adapter Contract

The adapter exports:

~~~js
normalizeControlText(value)
isSafeExpandLabel(value)
listSafeExpandLabels(controls)
createCandidateHash(value)
toCommentCandidate(raw, index, capturedAt)
buildCaptureState(input)
buildCommentDomBatch(input)
expandExactLabel(tab, rootSelector, label)
expandVisibleReplies(tab, profile, options)
captureScopedRecords(tab, profile)
scrollCommentContainer(tab, profile)
writeCaptureArtifacts(runDir, batch, state)
~~~

The only built-in profile in this change is:

~~~js
const PLATFORM_PROFILES = {
  douyin: {
    commentRootSelector: '.comment-mainContent',
    commentItemSelector: '.Eh0a5CD4',
    replyContainerSelector: '.replyContainer',
    endTexts: ['暂时没有更多评论']
  }
};
~~~

Other platforms must pass an explicit safe profile or use the existing fallback. The adapter must not guess a broad page root.

### Task 1: Build and test the safe Chrome adapter

**Files:**
- Create: src/browser/chrome-comment-capture.js
- Create: test/chrome-comment-capture.test.js

**Interfaces:**
- Consumes: a Chrome tab with playwright.locator and cua.scroll.
- Produces: expansion results, structural comment candidates, scroll observations, batches, and capture state.

- [ ] **Step 1: Write failing unit tests**

Create test/chrome-comment-capture.test.js:

~~~js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const capture = require('../src/browser/chrome-comment-capture.js');

test('keeps only exact reply expansion controls when collapse shares the same class', () => {
  assert.deepEqual(
    capture.listSafeExpandLabels([
      { text: '展开更多', visible: true },
      { text: '展开 5 条回复', visible: true },
      { text: '收起', visible: true },
      { text: '展开全文', visible: true },
      { text: '展开更多', visible: false },
      { text: '查看全部 8 条回复', visible: true, disabled: true }
    ]),
    ['展开更多', '展开 5 条回复']
  );
  assert.equal(capture.isSafeExpandLabel('收起'), false);
});

test('emits structural top-level and reply candidates', () => {
  const candidate = capture.toCommentCandidate({
    author: '用户A',
    content: '顶层评论',
    time: '3周前·北京',
    dom_path: 'DIV:nth-of-type(1)',
    html: '<div>顶层评论</div>',
    nearby_buttons: ['回复'],
    rect: { top: 0, left: 0, width: 300, height: 80 },
    type: 'comment'
  }, 1, '2026-07-10T00:00:00.000Z');

  assert.equal(candidate.role_hint, 'comment_candidate');
  assert.match(candidate.inner_text, /用户A 顶层评论/);
  assert.match(candidate.candidate_hash, /^[a-f0-9]{40}$/);
});
~~~

- [ ] **Step 2: Verify the test fails**

Run:

~~~bash
node --test --test-reporter=dot test/chrome-comment-capture.test.js
~~~

Expected: FAIL because src/browser/chrome-comment-capture.js is absent.

- [ ] **Step 3: Implement the pure adapter functions**

Create src/browser/chrome-comment-capture.js with these exact constants and functions:

~~~js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLATFORM_PROFILES = {
  douyin: {
    commentRootSelector: '.comment-mainContent',
    commentItemSelector: '.Eh0a5CD4',
    replyContainerSelector: '.replyContainer',
    endTexts: ['暂时没有更多评论']
  }
};

const SAFE_EXPAND_PATTERNS = [
  /^展开更多(?:回复|评论)?$/,
  /^展开\s*\d+\s*条?回复$/,
  /^展开\s*\d+\s*回复$/,
  /^查看更多回复$/,
  /^查看全部\s*\d+\s*条回复$/
];
const REJECT_EXPAND_PATTERNS = [/收起/, /展开全文/, /商品/, /详情/];

function normalizeControlText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isSafeExpandLabel(value) {
  const text = normalizeControlText(value);
  return Boolean(text) &&
    !REJECT_EXPAND_PATTERNS.some(pattern => pattern.test(text)) &&
    SAFE_EXPAND_PATTERNS.some(pattern => pattern.test(text));
}

function listSafeExpandLabels(controls) {
  return [...new Set((controls || [])
    .filter(control => control && control.visible !== false && !control.disabled)
    .map(control => normalizeControlText(control.text))
    .filter(isSafeExpandLabel))];
}

function createCandidateHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function toCommentCandidate(raw, index, capturedAt) {
  const innerText = [raw.author, raw.content, raw.time].filter(Boolean).join(' ');
  return {
    candidate_id: 'candidate_' + String(index).padStart(6, '0'),
    candidate_hash: createCandidateHash(raw.type + '|' + raw.dom_path + '|' + innerText),
    dom_path: raw.dom_path,
    role_hint: raw.type === 'reply' ? 'reply_candidate' : 'comment_candidate',
    inner_text: innerText,
    html: raw.html || '',
    nearby_buttons: Array.isArray(raw.nearby_buttons) ? raw.nearby_buttons : [],
    rect: raw.rect,
    captured_at: capturedAt
  };
}
~~~

Export every named function plus PLATFORM_PROFILES. Implement buildCaptureState so it returns declared_comment_count, captured_record_count, remaining_expand_count, scroll_top, scroll_height, client_height, end_signal, count_gap, stop_reason, and seen_candidate_hashes. Compute count_gap as the positive declared-minus-captured difference.

- [ ] **Step 4: Run the unit tests**

Run:

~~~bash
node --test --test-reporter=dot test/chrome-comment-capture.test.js
~~~

Expected: PASS with 2 tests.

- [ ] **Step 5: Add failing exact-label interaction tests**

Append:

~~~js
test('clicks exact scoped expansion controls bottom-up without touching collapse controls', async () => {
  const clicked = [];
  const labels = ['展开更多', '收起', '展开更多'];
  const root = {
    async count() { return 1; },
    getByText(label, options) {
      assert.equal(options.exact, true);
      return {
        async count() {
          return labels.filter(item => item === label).length;
        },
        async all() {
          return labels.map((item, index) => ({ item, index }))
            .filter(item => item.item === label)
            .map(item => ({
              async click() {
                clicked.push(item.index);
                labels[item.index] = '收起';
              }
            }));
        }
      };
    }
  };
  const tab = {
    playwright: { locator(selector) {
      assert.equal(selector, '.comment-mainContent');
      return root;
    } }
  };

  const result = await capture.expandExactLabel(tab, '.comment-mainContent', '展开更多');

  assert.deepEqual(clicked, [2, 0]);
  assert.deepEqual(result, { label: '展开更多', before: 2, clicked: 2, after: 0 });
});
~~~

- [ ] **Step 6: Verify the interaction test fails**

Run:

~~~bash
node --test --test-reporter=dot test/chrome-comment-capture.test.js
~~~

Expected: FAIL because expandExactLabel is absent.

- [ ] **Step 7: Implement safe interaction, scoped capture, scrolling, and persistence**

Add the following behavior:

~~~js
async function requireUniqueRoot(tab, rootSelector) {
  const root = tab.playwright.locator(rootSelector);
  const count = await root.count();
  if (count !== 1) {
    throw new Error('Expected one comment root for ' + rootSelector + ', found ' + count);
  }
  return root;
}

async function expandExactLabel(tab, rootSelector, label) {
  if (!isSafeExpandLabel(label)) {
    throw new Error('Refusing non-expansion label: ' + label);
  }
  const root = await requireUniqueRoot(tab, rootSelector);
  const locator = root.getByText(label, { exact: true });
  const before = await locator.count();
  const controls = await locator.all();
  let clicked = 0;
  for (let index = controls.length - 1; index >= 0; index -= 1) {
    await controls[index].click();
    clicked += 1;
  }
  return { label, before, clicked, after: await locator.count() };
}
~~~

Implement inspectCommentRoot with root.evaluate. It must:

1. query only profile.commentItemSelector below the root;
2. classify a reply when the immediate parent matches profile.replyContainerSelector;
3. project author, comment content before nested reply containers, time, likes, dom_path, HTML, nearby buttons, and rect;
4. return visible interactive control text, the end signal from profile.endTexts, and the scroll metrics of the comment-specific scroll parent;
5. make no DOM writes, cloneNode calls, or body-wide text reads.

Implement expandVisibleReplies as a fresh discovery loop capped by options.maxRounds or 50. In every round, call inspectCommentRoot, call listSafeExpandLabels, then call expandExactLabel once per discovered label. On zero remaining labels, return buildCaptureState with stop_reason equal to end-of-comments when an end signal exists, otherwise no-expand-controls. At the limit, use max-rounds.

Implement scrollCommentContainer by observing the comment scroll metrics, using tab.cua.scroll at the container midpoint with a delta of max(360, floor(client_height times 0.85)), then observing again. Return before_top, after_top, viewport_height, document_height, and changed.

Implement buildCommentDomBatch and writeCaptureArtifacts. writeCaptureArtifacts must create runs/<task_id>/batches/<batch_id>/comment-dom-batch.json and runs/<task_id>/capture-state.json with UTF-8 JSON and a trailing newline.

- [ ] **Step 8: Add end-signal, count-gap, and artifact tests**

Append tests that pass an inspectCommentRoot mock returning declared_comment_count 216, captured_record_count 197, end_signal 暂时没有更多评论, and no safe labels. Assert stop_reason is end-of-comments, count_gap is 19, and remaining_expand_count is 0. Also use fs.mkdtempSync to assert writeCaptureArtifacts creates both required files.

- [ ] **Step 9: Run adapter and legacy regression tests**

Run:

~~~bash
node --test --test-reporter=dot test/chrome-comment-capture.test.js test/expand-comments-v1.test.js test/crawl-comments-playwright.test.js
~~~

Expected: PASS.

- [ ] **Step 10: Commit the adapter**

Run:

~~~bash
git add src/browser/chrome-comment-capture.js test/chrome-comment-capture.test.js
git commit -m "feat: capture chrome comments safely"
~~~

### Task 2: Add batch state and QA count-gap reporting

**Files:**
- Modify: schemas/comment-dom-batch.schema.json
- Modify: test/comment-dom-batch-schema.test.js
- Modify: src/pipeline/qa_comment_delivery.py
- Modify: test/pipeline/test_qa_comment_delivery.py

**Interfaces:**
- Consumes: Task 1 capture-state.json.
- Produces: declared_comment_count, rendered_comment_count, rendered_count_gap, and capture_end_signal in QA task output.

- [ ] **Step 1: Write failing schema and QA tests**

Append to test/comment-dom-batch-schema.test.js:

~~~js
test('comment batch state permits Chrome observation fields', () => {
  const state = schema.properties.state;
  for (const field of [
    'declared_comment_count',
    'captured_record_count',
    'remaining_expand_count',
    'end_signal',
    'count_gap'
  ]) {
    assert.ok(state.properties[field], 'missing ' + field);
  }
});
~~~

Append to test/pipeline/test_qa_comment_delivery.py:

~~~python
def test_task_qa_reports_rendered_count_gap_without_downgrading_a_passing_task(tmp_path: Path):
    project = make_project(tmp_path, expected_comment_count=100, actual_comment_count=100)
    run_dir = project / "runs" / "task_001"
    run_dir.mkdir(parents=True)
    (run_dir / "capture-state.json").write_text(
        json.dumps(
            {
                "declared_comment_count": 216,
                "captured_record_count": 197,
                "count_gap": 19,
                "end_signal": "暂时没有更多评论",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    task = qa_comment_delivery.build_qa_summary(project)["tasks"][0]

    assert task["status"] == "ok"
    assert task["rendered_count_gap"] == 19
    assert task["capture_end_signal"] == "暂时没有更多评论"
    assert "平台展示 216 条" in task["notes"]
~~~

- [ ] **Step 2: Verify the tests fail**

Run:

~~~bash
node --test --test-reporter=dot test/comment-dom-batch-schema.test.js
python -m unittest test.pipeline.test_qa_comment_delivery
~~~

Expected: FAIL because the state fields and QA metrics do not exist.

- [ ] **Step 3: Extend state schema without changing required v1 fields**

Add optional integer fields declared_comment_count, captured_record_count, remaining_expand_count, and count_gap with minimum 0, plus string field end_signal, to properties.state.properties in schemas/comment-dom-batch.schema.json. Do not change required state fields or schema_version.

In src/pipeline/qa_comment_delivery.py add:

~~~python
def read_task_capture_state(project_dir: Path, task_id: str) -> dict[str, Any]:
    return read_json_if_exists(project_dir / "runs" / task_id / "capture-state.json")


def capture_observation(capture_state: dict[str, Any]) -> dict[str, Any]:
    declared = int(capture_state.get("declared_comment_count") or 0)
    rendered = int(capture_state.get("captured_record_count") or 0)
    gap = int(capture_state.get("count_gap") or max(declared - rendered, 0))
    return {
        "declared_comment_count": declared,
        "rendered_comment_count": rendered,
        "rendered_count_gap": gap,
        "capture_end_signal": str(capture_state.get("end_signal") or ""),
    }
~~~

Pass the capture state into build_task_qa, merge capture_observation into metrics, and add this build_notes branch:

~~~python
    if metrics.get("rendered_count_gap"):
        notes.append(
            f"平台展示 {metrics['declared_comment_count']} 条，"
            f"当前会话可读 {metrics['rendered_comment_count']} 条，"
            f"差异 {metrics['rendered_count_gap']} 条"
        )
~~~

Do not append rendered_count_gap to issues. In build_qa_summary, call read_task_capture_state for each task and pass it to build_task_qa.

- [ ] **Step 4: Run schema and QA tests**

Run:

~~~bash
node --test --test-reporter=dot test/comment-dom-batch-schema.test.js
python -m unittest test.pipeline.test_qa_comment_delivery
python -m unittest discover -s test/pipeline
~~~

Expected: PASS. The capture count gap appears in notes while status remains ok when existing completion gates pass.

- [ ] **Step 5: Commit schema and QA support**

Run:

~~~bash
git add schemas/comment-dom-batch.schema.json test/comment-dom-batch-schema.test.js src/pipeline/qa_comment_delivery.py test/pipeline/test_qa_comment_delivery.py
git commit -m "feat: report chrome capture count gaps"
~~~

### Task 3: Replace canonical Chrome skill and workflow guidance

**Files:**
- Modify: .codex/skills/comment-excel-delivery/SKILL.md
- Modify: .codex/skills/comment-excel-delivery/references/workflow.md
- Modify: docs/comment-crawler-mcp-usage.md
- Modify: test/pipeline/test_comment_excel_delivery_skill.py
- Modify: test/comment-crawler-mcp-usage-doc.test.js

**Interfaces:**
- Consumes: Task 1 adapter contract and Task 2 state/QA names.
- Produces: safe default instructions without broad class or non-exact text interaction.

- [ ] **Step 1: Write failing documentation checks**

Add this test to test/comment-crawler-mcp-usage-doc.test.js:

~~~js
test('usage documentation requires exact-label capture and rendered count reporting', () => {
  const doc = fs.readFileSync(docPath, 'utf8');
  for (const text of [
    'chrome-comment-capture.js',
    'exact text',
    '收起',
    'bottom-up',
    'count_gap',
    '暂时没有更多评论'
  ]) {
    assert.ok(doc.includes(text), 'missing ' + text);
  }
  assert.doesNotMatch(doc, /getByText\(label, \{ exact: false \}\)\.all/);
});
~~~

Add the same six required strings to test_skill_declares_chrome_as_default_browser_workflow in test/pipeline/test_comment_excel_delivery_skill.py.

- [ ] **Step 2: Verify documentation checks fail**

Run:

~~~bash
node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js
python -m unittest test.pipeline.test_comment_excel_delivery_skill
~~~

Expected: FAIL because the current example uses getByText with exact false and broad candidate extraction.

- [ ] **Step 3: Replace unsafe default instructions**

Update SKILL.md to name src/browser/chrome-comment-capture.js as the reusable Chrome default and require exact visible labels, a unique comment root, bottom-up clicking, re-observation after every click batch, comment-container-only scrolling, and count_gap persistence.

Replace the Chrome default per-task workflow in references/workflow.md with:

~~~text
1. Initialize Chrome through chrome:control-chrome and claim the task tab.
2. Resolve the explicit platform profile and confirm one unique comment root.
3. Discover visible exact expansion labels within that root.
4. Expand one label at a time from bottom-up. Never select by a shared class and never click 收起.
5. Re-observe safe labels, scoped records, declared count, end signal, and scroll metrics.
6. Write comment-dom-batch.json and capture-state.json before scrolling only the comment container with tab.cua.
7. Repeat until a reliable idle or 暂时没有更多评论 end signal.
8. Preserve count_gap in capture-state and QA notes.
~~~

In docs/comment-crawler-mcp-usage.md, remove the loop using getByText(label, { exact: false }).all and the page-wide candidate locator. Replace it with an adapter example that imports src/browser/chrome-comment-capture.js, calls expandVisibleReplies, captureScopedRecords, scrollCommentContainer, buildCommentDomBatch, and writeCaptureArtifacts.

Keep the existing login/CAPTCHA/verification pause, modal_id navigation, accidental profile tab cleanup, full QA completion gate, and MCP/CDP fallback sections.

- [ ] **Step 4: Run documentation and regression checks**

Run:

~~~bash
node --test --test-reporter=dot test/comment-crawler-mcp-usage-doc.test.js test/chrome-comment-capture.test.js test/comment-dom-batch-schema.test.js
python -m unittest test.pipeline.test_comment_excel_delivery_skill
~~~

Expected: PASS.

- [ ] **Step 5: Commit the workflow replacement**

Run:

~~~bash
git add .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md docs/comment-crawler-mcp-usage.md test/comment-crawler-mcp-usage-doc.test.js test/pipeline/test_comment_excel_delivery_skill.py
git commit -m "docs: make chrome comment capture exact and scoped"
~~~

### Task 4: Verify the complete replacement

**Files:**
- Verify: all files from Tasks 1 through 3.

**Interfaces:**
- Consumes: the completed adapter, schema, QA, skill, and documentation.
- Produces: evidence that safe Chrome behavior is canonical and legacy behavior is unchanged.

- [ ] **Step 1: Run the complete Node suite**

Run:

~~~bash
node --test --test-reporter=dot test/*.test.js
~~~

Expected: PASS.

- [ ] **Step 2: Run the complete Python pipeline suite**

Run:

~~~bash
python -m unittest discover -s test/pipeline
~~~

Expected: PASS.

- [ ] **Step 3: Inspect whitespace and worktree scope**

Run:

~~~bash
git diff --check HEAD~3..HEAD
git status --short
~~~

Expected: no whitespace errors. Do not stage or commit the pre-existing untracked file douyin_comments_7652654194016521499.json.

- [ ] **Step 4: Commit only a necessary verification correction**

If a verification command exposes a source, test, schema, or documentation error, make the smallest correction, rerun the failed command and its focused tests, then run:

~~~bash
git add <corrected-files>
git commit -m "fix: align safe chrome comment capture"
~~~

Do not create a verification commit when no correction is needed.

# Weibo Chrome Comment Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TCL Weibo comment API crawler with a Chrome-plugin-only, DOM-evidence-backed, model-structured comment pipeline that preserves hot/time sorting and safely expanded replies.

**Architecture:** A validated, runtime Weibo profile supplies the only selectors and DOM identity attributes used by the Chrome capture helpers. Capture windows are evidence batches; a new deterministic preparation step deduplicates and repacks them into bounded model batches. The model extracts visible text fields only, while the normalizer writes comment IDs and reply relationships from DOM evidence. QA evaluates each sort stream separately and treats unsafe or incomplete capture as `partial`.

**Tech Stack:** Node.js built-in test runner, JSON Schema Draft 2020-12, Codex CLI strict output schemas, Python `unittest`, `chrome:control-chrome`, existing JSONL/Excel pipeline.

## Global Constraints

- Preserve the existing Weibo search-post and official-account-post interface workflows; this plan replaces only comment collection.
- Do not use MCP, CDP, OpenCLI, Weibo AJAX endpoints, cookies, local storage, or hidden API requests for Weibo comments.
- Chrome reads only the unique, visible comment scope and public DOM attributes. Login, CAPTCHA, verification, or access restrictions pause for user action.
- Collect both exact UI sort modes: `hot` (`按热度`) and `time` (`按时间`). A missing or unverifiable sort mode yields `partial`.
- Expand replies only with exact labels inside the verified comment root; never click `收起`, `展开全文`, `商品`, `详情`, or a generic `回复` action.
- A stable DOM `source_comment_id` is mandatory for cross-sort completion. Text fingerprints may suppress duplicate candidates but may not produce an `ok` completion state.
- Browser evidence batches and model batches are distinct. Use at most 80 unique candidates or 24,000 candidate-text characters per model batch, whichever arrives first.
- Keep `comment-dom-batch-v1` and `ai-comment-extraction-v1` artifact names. Extend their JSON schemas additively; do not create a second raw-comment format.
- Preserve canonical project schemas. Every Codex CLI invocation receives a generated strict clone from `src/normalize/model-output-schema.js`.
- Use test-driven development: write and run the named failing test before each implementation step, then rerun it after the smallest implementation.
- Do not generate a formal Excel delivery while project QA is anything other than `ok`, except for explicitly labelled test/sample output.

---

## File Structure

- Create `schemas/weibo-comment-profile.schema.json`: validates the explicit selectors, sort controls, end texts, safe reply labels, and DOM identity attributes discovered on real pages.
- Create `src/browser/weibo-comment-profile.js` and `script/validate-weibo-comment-profile.js`: load and validate profile files without guessing selectors.
- Modify `src/browser/chrome-comment-capture.js`: preserve DOM IDs, capture stream state, switch verified sort controls, and write capture evidence batches.
- Modify `schemas/comment-dom-batch.schema.json`: support `weibo`, `capture`/`model` batch kinds, sort mode, source identity, and evidence origins.
- Create `src/normalize/prepare-comment-extraction-batches.js` and `script/prepare-comment-extraction-batches.js`: merge capture evidence into bounded model input batches.
- Create `src/normalize/run-comment-ai-extraction.js` and `script/run-comment-ai-extraction.js`: invoke Codex once per model batch with a generated strict schema.
- Create `src/adapters/weibo.js`: canonicalize Weibo URLs and extract a stable post identifier.
- Modify `src/normalize/normalize-ai-comment-extraction.js`, `src/pipeline/merge_task_batches.py`, and `src/pipeline/qa_comment_delivery.py`: deterministically retain Weibo IDs, merge model results, and QA stream completion.
- Modify `schemas/ai-comment-extraction.schema.json`, `prompts/comment-candidate-batch-extraction.md`, `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`, `.codex/skills/comment-excel-delivery/SKILL.md`, and its workflow reference: document Chrome/model-only Weibo capture.
- Add focused Node and Python regression tests listed in the tasks below.

## Task 1: Define And Prove The Explicit Weibo Chrome Profile Contract

**Files:**
- Create: `schemas/weibo-comment-profile.schema.json`
- Create: `src/browser/weibo-comment-profile.js`
- Create: `script/validate-weibo-comment-profile.js`
- Create: `test/weibo-comment-profile.test.js`
- Modify: `test/project-structure.test.js`
- Create at runtime, ignored: `output/weibo-profile-probe/weibo-comment-profile.json`

**Interfaces:**
- Consumes: a JSON profile created from a logged-in, visible Weibo detail page.
- Produces: `readWeiboCommentProfile(filePath): WeiboCommentProfile`, which either returns a fully validated profile or throws one error containing every missing/invalid field.
- Produces: a profile object with `postRootSelector`, `commentRootSelector`, `commentItemSelector`, `replyContainerSelector`, `scrollContainerSelector`, `sortScopeSelector`, `sorts`, `endTexts`, `safeReplyExpandPatterns`, and `identityAttributes`.

- [ ] **Step 1: Write the failing profile-contract test**

Create `test/weibo-comment-profile.test.js` with a complete valid fixture and rejection cases:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const profile = require('../src/browser/weibo-comment-profile.js');

const validProfile = {
  platform: 'weibo',
  postRootSelector: 'article[data-post-root]',
  commentRootSelector: 'section[data-comment-root]',
  commentItemSelector: 'article[data-comment-id]',
  replyContainerSelector: '[data-reply-list]',
  scrollContainerSelector: '[data-comment-scroll]',
  sortScopeSelector: '[data-comment-sort]',
  sorts: {
    hot: { label: '按热度', selectedAttribute: 'aria-selected', selectedValue: 'true' },
    time: { label: '按时间', selectedAttribute: 'aria-selected', selectedValue: 'true' }
  },
  endTexts: ['没有更多评论了'],
  safeReplyExpandPatterns: ['^展开更多回复$'],
  identityAttributes: {
    comment: ['data-comment-id'],
    parent: ['data-parent-comment-id'],
    root: ['data-root-comment-id']
  }
};

test('accepts a complete explicit Weibo profile', () => {
  assert.deepEqual(profile.validateWeiboCommentProfile(validProfile), []);
});

test('rejects profiles that would force broad DOM discovery or ambiguous sorting', () => {
  const invalid = structuredClone(validProfile);
  invalid.commentRootSelector = '';
  invalid.sorts.time.label = '';
  invalid.identityAttributes.comment = [];
  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'commentRootSelector is required',
    'sorts.time.label is required',
    'identityAttributes.comment must contain at least one attribute'
  ]);
});
```

Add a `test/project-structure.test.js` wrapper pair assertion for `src/browser/weibo-comment-profile.js` and `script/validate-weibo-comment-profile.js`.

- [ ] **Step 2: Run the profile test and verify RED**

Run:

```bash
node --test test/weibo-comment-profile.test.js test/project-structure.test.js
```

Expected: FAIL because `src/browser/weibo-comment-profile.js` and the wrapper do not exist.

- [ ] **Step 3: Implement the schema, validator, and CLI wrapper**

Create the schema with `additionalProperties: false`. Require the profile fields from the interface block; require both `sorts.hot` and `sorts.time`, require their non-empty exact labels, and require at least one comment identity attribute.

In `src/browser/weibo-comment-profile.js`, implement these exported functions:

```js
function validateWeiboCommentProfile(value) {
  const errors = [];
  const requiredSelectors = [
    'postRootSelector', 'commentRootSelector', 'commentItemSelector',
    'replyContainerSelector', 'scrollContainerSelector', 'sortScopeSelector'
  ];
  for (const name of requiredSelectors) {
    if (!String(value?.[name] || '').trim()) errors.push(`${name} is required`);
  }
  for (const mode of ['hot', 'time']) {
    if (!String(value?.sorts?.[mode]?.label || '').trim()) {
      errors.push(`sorts.${mode}.label is required`);
    }
  }
  if (!Array.isArray(value?.identityAttributes?.comment) || !value.identityAttributes.comment.length) {
    errors.push('identityAttributes.comment must contain at least one attribute');
  }
  return errors;
}

function readWeiboCommentProfile(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const errors = validateWeiboCommentProfile(value);
  if (errors.length) throw new Error(`Invalid Weibo comment profile: ${errors.join('; ')}`);
  return value;
}
```

`script/validate-weibo-comment-profile.js` is a legacy wrapper. Its `main` parses `--profile <path>`, calls `readWeiboCommentProfile`, and prints the valid profile as JSON. Do not ship a default selector profile.

- [ ] **Step 4: Capture and validate real-page evidence through Chrome**

Using `chrome:control-chrome`, inspect three logged-in Weibo detail pages: one low-comment page, one page with visible replies, and one long-text/image/video page. Create `output/weibo-profile-probe/weibo-comment-profile.json` from selectors and DOM identity attributes observed in all three pages, then run:

```bash
node script/validate-weibo-comment-profile.js \
  --profile output/weibo-profile-probe/weibo-comment-profile.json
```

For each selector in the profile, confirm through the Chrome tab that the post root, comment root, sort scope, and scroll container each count exactly one; comment items count at least one; both sort labels are visible; and one level-1 plus one level-2 item exposes a stable comment identity. Save one screenshot and the read-only observation JSON per page under `output/weibo-profile-probe/`. Stop the plan if any check fails; do not substitute an API source or a guessed selector.

- [ ] **Step 5: Run the profile tests and verify GREEN**

Run:

```bash
node --test test/weibo-comment-profile.test.js test/project-structure.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add schemas/weibo-comment-profile.schema.json src/browser/weibo-comment-profile.js script/validate-weibo-comment-profile.js test/weibo-comment-profile.test.js test/project-structure.test.js
git commit -m "feat(weibo): define chrome comment profile contract"
```

## Task 2: Preserve DOM Identity And Per-Sort Capture State

**Files:**
- Modify: `src/browser/chrome-comment-capture.js`
- Modify: `schemas/comment-dom-batch.schema.json`
- Modify: `test/chrome-comment-capture.test.js`
- Modify: `test/comment-dom-batch-schema.test.js`

**Interfaces:**
- Consumes: a validated `WeiboCommentProfile` passed as the existing explicit profile argument.
- Produces: candidates with `capture_sort_mode`, `source_comment_id`, `source_parent_comment_id`, `source_root_comment_id`, and `source_capture_batch_ids`.
- Produces: `capture-state.json` with `streams.hot` and `streams.time`; existing scalar state fields remain for compatibility.

- [ ] **Step 1: Write failing capture and schema tests**

Add this test to `test/chrome-comment-capture.test.js`:

```js
test('preserves deterministic Weibo DOM identity instead of inventing an AI identity', () => {
  const candidate = capture.toCommentCandidate({
    candidate_id: 'weibo:c-100',
    source_comment_id: 'c-100',
    source_parent_comment_id: 'c-10',
    source_root_comment_id: 'c-1',
    capture_sort_mode: 'time',
    inner_text: '用户A 评论正文'
  });
  assert.equal(candidate.candidate_id, 'weibo:c-100');
  assert.equal(candidate.source_comment_id, 'c-100');
  assert.equal(candidate.source_parent_comment_id, 'c-10');
  assert.equal(candidate.source_root_comment_id, 'c-1');
  assert.equal(candidate.capture_sort_mode, 'time');
});

test('records completed hot and time stream observations', () => {
  const state = capture.buildCaptureState({
    platform: 'weibo',
    streams: {
      hot: { verified: true, stop_reason: 'page_end', unique_level1_count: 20 },
      time: { verified: true, stop_reason: 'page_end', unique_level1_count: 23 }
    }
  });
  assert.equal(state.streams.hot.verified, true);
  assert.equal(state.streams.time.unique_level1_count, 23);
});
```

Extend `test/comment-dom-batch-schema.test.js` to expect `weibo` in the platform enum, top-level optional `batch_kind`, and each candidate's optional identity/sort fields.

- [ ] **Step 2: Run the capture tests and verify RED**

Run:

```bash
node --test test/chrome-comment-capture.test.js test/comment-dom-batch-schema.test.js
```

Expected: FAIL because candidate identity fields and `streams` are absent.

- [ ] **Step 3: Implement additive candidate and state fields**

In `toCommentCandidate`, copy only normalized string values for the new identity fields and set a stable candidate ID when `source_comment_id` exists:

```js
const sourceCommentId = normalizeControlText(safeRaw.source_comment_id);
const candidateId = sourceCommentId
  ? `weibo:${sourceCommentId}`
  : (safeRaw.candidate_id || `candidate_${String(index).padStart(6, '0')}`);
```

Extend `inspectCommentRoot` so the supplied profile's `identityAttributes` are read from the comment item and its nearest reply/root ancestor. It must return empty strings when attributes do not exist. Do not derive IDs from text or ask the model to fill them.

Add a `normalizeStreamState` helper and include this immutable shape under `buildCaptureState(...).streams`:

```js
{
  hot: { verified: false, stop_reason: '', end_signal: '', unique_level1_count: 0, unique_reply_count: 0, remaining_expand_count: 0 },
  time: { verified: false, stop_reason: '', end_signal: '', unique_level1_count: 0, unique_reply_count: 0, remaining_expand_count: 0 }
}
```

In the batch schema, add optional `batch_kind` with enum `['capture', 'model']` and set capture batches to `capture`; add the candidate fields named in the interface. Retain all previous required properties and the v1 schema version.

- [ ] **Step 4: Run the capture tests and verify GREEN**

Run:

```bash
node --test test/chrome-comment-capture.test.js test/comment-dom-batch-schema.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/browser/chrome-comment-capture.js schemas/comment-dom-batch.schema.json test/chrome-comment-capture.test.js test/comment-dom-batch-schema.test.js
git commit -m "feat(weibo): preserve comment DOM identities"
```

## Task 3: Implement Safe Weibo Sort Switching And Chrome Capture Loops

**Files:**
- Modify: `src/browser/chrome-comment-capture.js`
- Modify: `test/chrome-comment-capture.test.js`
- Modify: `.codex/skills/comment-excel-delivery/references/workflow.md`

**Interfaces:**
- Consumes: an open Chrome task tab and a validated profile.
- Produces: `switchWeiboCommentSort(tab, profile, mode)` returning `{ mode, label, matched, clicked, verified }`.
- Produces: one capture batch after every scoped scroll and an updated stream observation after each sort mode.

- [ ] **Step 1: Write failing sort-safety tests**

Add tests that mock a single sort scope and assert all of the following:

```js
await assert.rejects(
  capture.switchWeiboCommentSort(tab, profile, 'unknown'),
  /Unsupported Weibo sort mode/
);
assert.equal(await capture.switchWeiboCommentSort(tab, profile, 'time').verified, true);
assert.equal(clickLog[0], '按时间');
```

Also add a failure case where the exact `按时间` control is found outside `sortScopeSelector`; it must never be queried or clicked. Add a changed-label test equivalent to the existing reply-expander recheck.

- [ ] **Step 2: Run the sort tests and verify RED**

Run:

```bash
node --test test/chrome-comment-capture.test.js
```

Expected: FAIL because `switchWeiboCommentSort` does not exist.

- [ ] **Step 3: Implement exact scoped sort switching**

Implement the function with this control flow:

```js
async function switchWeiboCommentSort(tab, profile, mode) {
  if (!['hot', 'time'].includes(mode)) throw new Error(`Unsupported Weibo sort mode: ${mode}`);
  const scope = await requireUniqueRoot(tab, profile.sortScopeSelector);
  const spec = profile.sorts[mode];
  const control = scope.getByText(normalizeControlText(spec.label), { exact: true });
  if (await control.count() !== 1) throw new Error(`Expected one ${mode} sort control`);
  if (!await controlCanBeClicked(control)) throw new Error(`Weibo ${mode} sort control is not clickable`);
  if (normalizeControlText(await control.innerText()) !== spec.label) throw new Error('Weibo sort label changed');
  await control.click();
  const selected = await control.getAttribute(spec.selectedAttribute);
  return { mode, label: spec.label, matched: 1, clicked: 1, verified: selected === spec.selectedValue };
}
```

If the profile uses class-based selection, add a profile option named `selectedClass` and verify it with `classList.contains`; do not use a page-wide text query. In the Chrome execution loop, capture `hot` fully, then switch and verify `time`, capture it fully, and write the corresponding `streams` entries. On login walls, CAPTCHA, ambiguous root, unverified sort, no-progress stop, or accidental task-tab navigation, stop the active stream and return `partial` evidence.

Update the workflow reference with a Weibo-specific section: `chrome:control-chrome` is the only Weibo capture surface; no MCP/API fallback is permitted.

- [ ] **Step 4: Run the sort tests and verify GREEN**

Run:

```bash
node --test test/chrome-comment-capture.test.js
```

Expected: PASS.

- [ ] **Step 5: Manually verify one dual-sort task in Chrome**

Use a profile from Task 1 to capture one Weibo detail page. Verify that the two `streams` objects have distinct `verified` flags and that all `capture` batches contain only candidates from the expected comment root. Finalize the task tab after capture.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/browser/chrome-comment-capture.js test/chrome-comment-capture.test.js .codex/skills/comment-excel-delivery/references/workflow.md
git commit -m "feat(weibo): capture verified comment sort streams"
```

## Task 4: Repack Capture Evidence Into Bounded Model Batches

**Files:**
- Create: `src/normalize/prepare-comment-extraction-batches.js`
- Create: `script/prepare-comment-extraction-batches.js`
- Create: `test/prepare-comment-extraction-batches.test.js`
- Modify: `src/pipeline/qa_comment_delivery.py`
- Modify: `test/pipeline/test_qa_comment_delivery.py`
- Modify: `test/project-structure.test.js`

**Interfaces:**
- Consumes: `runs/<task_id>/batches/capture_*/comment-dom-batch.json`.
- Produces: `runs/<task_id>/batches/model_*/comment-dom-batch.json` and `runs/<task_id>/model-batch-manifest.json`.
- Produces: `prepareModelBatches({ taskDir, maxCandidates: 80, maxTextChars: 24000 })` with deterministic output order.

- [ ] **Step 1: Write failing model-batch preparation tests**

Create a fixture with two capture batches where the same `source_comment_id` appears once in each sort. Assert:

```js
const result = prep.prepareModelBatches({ taskDir, maxCandidates: 2, maxTextChars: 1000 });
assert.equal(result.captureCandidateCount, 3);
assert.equal(result.uniqueCandidateCount, 2);
assert.equal(result.modelBatchCount, 1);
const batch = JSON.parse(fs.readFileSync(result.modelBatchPaths[0], 'utf8'));
assert.equal(batch.batch_kind, 'model');
assert.deepEqual(batch.candidates[0].source_capture_batch_ids.sort(), ['capture_hot_001', 'capture_time_001']);
```

Add a second test with three long candidates proving that a candidate which would exceed `maxTextChars` starts the next model batch. Add a QA test proving that capture batches are not reported as missing `ai-comment-extraction.json`, while model batches are.

- [ ] **Step 2: Run the preparation and QA tests and verify RED**

Run:

```bash
node --test test/prepare-comment-extraction-batches.test.js test/project-structure.test.js
uv run --project src/pipeline python -m unittest test.pipeline.test_qa_comment_delivery
```

Expected: FAIL because the preparation module and model-batch semantics do not exist.

- [ ] **Step 3: Implement deterministic aggregation and bounded chunking**

Implement these rules:

```js
function candidateMergeKey(candidate) {
  return String(candidate.source_comment_id || candidate.candidate_hash || candidate.candidate_id);
}

function shouldStartNewBatch(current, candidate, limits) {
  return current.candidates.length > 0 && (
    current.candidates.length >= limits.maxCandidates ||
    current.textChars + candidate.inner_text.length > limits.maxTextChars
  );
}
```

Read only `batch_kind === 'capture'` artifacts, iterate them by directory name, and merge in first-seen order. For every merged candidate, union and sort `source_capture_batch_ids`; do not overwrite its DOM identity with model output. Write each model artifact with `batch_kind: 'model'`, its own `batch_id` (`model_001`, `model_002`, ...), `state.has_more: false`, and the merged candidates. Persist a manifest with counts, limits, source capture batch IDs, and output paths.

In `read_task_batch_metrics`, only require AI extraction and normalized files for `batch_kind == 'model'`. A capture batch with `has_more` still contributes a truncation issue; a capture batch without an AI file does not.

- [ ] **Step 4: Run the preparation and QA tests and verify GREEN**

Run:

```bash
node --test test/prepare-comment-extraction-batches.test.js test/project-structure.test.js
uv run --project src/pipeline python -m unittest test.pipeline.test_qa_comment_delivery
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/normalize/prepare-comment-extraction-batches.js script/prepare-comment-extraction-batches.js test/prepare-comment-extraction-batches.test.js src/pipeline/qa_comment_delivery.py test/pipeline/test_qa_comment_delivery.py test/project-structure.test.js
git commit -m "feat(comment-ai): batch captured candidates for models"
```

## Task 5: Run Model Extraction With The Strict Schema Clone

**Files:**
- Create: `src/normalize/run-comment-ai-extraction.js`
- Create: `script/run-comment-ai-extraction.js`
- Create: `test/comment-ai-extraction-runner.test.js`
- Modify: `schemas/ai-comment-extraction.schema.json`
- Modify: `prompts/comment-candidate-batch-extraction.md`
- Modify: `test/ai-comment-extraction-schema.test.js`
- Modify: `test/model-output-schema.test.js`
- Modify: `test/project-structure.test.js`

**Interfaces:**
- Consumes: model batches from Task 4 and the canonical extraction schema.
- Produces: one `ai-comment-extraction.json` beside each `batch_kind: 'model'` artifact.
- Produces: `runExtractionBatches({ taskDir, dryRun, codexBin, schemaPath, cwd })`, returning per-batch command/result metadata.

- [ ] **Step 1: Write failing runner and schema tests**

Test a dry run with one model batch and assert:

```js
const result = runner.runExtractionBatches({ taskDir, dryRun: true, codexBin: '/tmp/codex', cwd: '/tmp/project' });
assert.equal(result.batchCount, 1);
assert.equal(fs.existsSync(path.join(taskDir, 'model-output-schema.json')), true);
assert.equal(result.results[0].command.args.includes(path.join(taskDir, 'model-output-schema.json')), true);
assert.match(result.results[0].prompt, /"platform": "weibo"/);
```

Extend the extraction schema test with:

```js
assert.equal(schema.properties.platform.enum.includes('weibo'), true);
```

Extend the strict-schema test to assert the cloned extraction schema requires `platform`, while the canonical extraction schema may keep it optional.

- [ ] **Step 2: Run the runner and schema tests and verify RED**

Run:

```bash
node --test test/comment-ai-extraction-runner.test.js test/ai-comment-extraction-schema.test.js test/model-output-schema.test.js test/project-structure.test.js
```

Expected: FAIL because the extraction runner does not exist and the schema rejects `weibo`.

- [ ] **Step 3: Implement the strict-schema extraction runner**

Build the prompt by concatenating `prompts/comment-candidate-batch-extraction.md` and the complete model batch JSON. It must say that source IDs are DOM evidence and are not model output fields. Reuse `writeModelOutputSchema` exactly once per run:

```js
const modelSchemaPath = path.join(args.taskDir, 'model-output-schema.json');
writeModelOutputSchema(args.schemaPath, modelSchemaPath);
```

For each `batch_kind === 'model'`, invoke the same `codex exec --skip-git-repo-check --sandbox read-only --output-schema <strict clone> -o <batch output> -` command shape used by `run-comment-ai-review.js`. In dry-run mode, write the strict schema but do not invoke the model. Do not run capture batches through the model.

Add `weibo` to the canonical extraction schema platform enum. Update the prompt with a Weibo example and the exact sentence: “`source_comment_id`、父评论 ID 和根评论 ID 由 DOM 证据回填，禁止模型推测或输出。”

- [ ] **Step 4: Run the runner and schema tests and verify GREEN**

Run:

```bash
node --test test/comment-ai-extraction-runner.test.js test/ai-comment-extraction-schema.test.js test/model-output-schema.test.js test/project-structure.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/normalize/run-comment-ai-extraction.js script/run-comment-ai-extraction.js test/comment-ai-extraction-runner.test.js schemas/ai-comment-extraction.schema.json prompts/comment-candidate-batch-extraction.md test/ai-comment-extraction-schema.test.js test/model-output-schema.test.js test/project-structure.test.js
git commit -m "feat(comment-ai): run strict extraction batches"
```

## Task 6: Normalize Weibo IDs And Deduplicate Across Sort Streams

**Files:**
- Create: `src/adapters/weibo.js`
- Create: `adapters/weibo.js`
- Create: `test/weibo-adapter.test.js`
- Modify: `src/normalize/normalize-ai-comment-extraction.js`
- Modify: `test/normalize-ai-comment-extraction.test.js`
- Modify: `src/pipeline/merge_task_batches.py`
- Modify: `test/pipeline/test_merge_task_batches.py`
- Modify: `test/project-structure.test.js`

**Interfaces:**
- Produces: `extractWeiboPostId(sourceUrl): string`, returning `<author-or-detail-path>/<status-token>` for canonical Weibo detail URLs or an empty string for unsupported URLs.
- Produces: normalized rows whose `comment_id`, `parent_comment_id`, `root_comment_id`, `post_id`, and `row_key` come from candidate evidence when present.

- [ ] **Step 1: Write failing Weibo adapter and cross-stream normalization tests**

Create URL tests for `https://weibo.com/1812511057/Pa1Bc2D3e`, `https://www.weibo.com/detail/Pa1Bc2D3e`, and malformed URLs. Add this normalization test:

```js
const rows = normalizer.normalizeAiExtraction({
  platform: 'weibo', source_url: 'https://weibo.com/1812511057/Pa1Bc2D3e',
  rows: [{ source_chunk_id: 'weibo:c-100', row_type: 'level1', user_name: '用户A', text: '评论', created_at: '', like_count: 0, reply_to_user_name: '', root_text: '', is_pinned: false, is_author: false, confidence: 'high', evidence: '' }]
}, { snapshot: { schema_version: 'comment-dom-batch-v1', batch_id: 'model_001', candidates: [{ candidate_id: 'weibo:c-100', source_comment_id: 'c-100', source_parent_comment_id: '', source_root_comment_id: 'c-100', source_capture_batch_ids: ['capture_hot_001', 'capture_time_001'] }] } });
assert.equal(rows[0].comment_id, 'c-100');
assert.equal(rows[0].root_comment_id, 'c-100');
assert.equal(rows[0].post_id, '1812511057/Pa1Bc2D3e');
```

Add a merge test containing two rows with the same `row_key` from different model batches; assert exactly one row remains and `duplicate_count` is `1`.

- [ ] **Step 2: Run adapter, normalizer, and merge tests and verify RED**

Run:

```bash
node --test test/weibo-adapter.test.js test/normalize-ai-comment-extraction.test.js test/project-structure.test.js
uv run --project src/pipeline python -m unittest test.pipeline.test_merge_task_batches
```

Expected: FAIL because there is no Weibo adapter and normalization leaves IDs empty.

- [ ] **Step 3: Implement evidence-first Weibo normalization**

Add `src/adapters/weibo.js` with a URL parser that accepts only `weibo.com/<uid>/<status>` and `weibo.com/detail/<status>` shapes and removes query/hash components. Add a legacy wrapper under `adapters/weibo.js`.

In `normalize-ai-comment-extraction.js`, build a candidate map keyed by `candidate_id`. For every AI row, use its `source_chunk_id` to read the candidate and apply these precedence rules:

```js
const commentId = normalizeSpaces(sourceChunk?.source_comment_id);
const rowKey = commentId
  ? buildRowKey([platform, sourceUrl, commentId])
  : buildRowKey([platform, sourceUrl, rowType, sourceChunkId, userName, text, sourceBatchId]);
```

Copy `source_parent_comment_id` and `source_root_comment_id` when present. For a level-1 row with a comment ID but no root ID, set root ID to the comment ID. Preserve `source_capture_batch_ids` inside `raw.source_chunk`; do not add an AI-supplied ID to canonical rows.

Keep `merge_task_batches.py` row-key dedupe but document it in the summary as `duplicate_count`; no text-only cross-stream merge may change an evidence-backed row's identity.

- [ ] **Step 4: Run adapter, normalizer, and merge tests and verify GREEN**

Run:

```bash
node --test test/weibo-adapter.test.js test/normalize-ai-comment-extraction.test.js test/project-structure.test.js
uv run --project src/pipeline python -m unittest test.pipeline.test_merge_task_batches
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add src/adapters/weibo.js adapters/weibo.js test/weibo-adapter.test.js src/normalize/normalize-ai-comment-extraction.js test/normalize-ai-comment-extraction.test.js src/pipeline/merge_task_batches.py test/pipeline/test_merge_task_batches.py test/project-structure.test.js
git commit -m "feat(weibo): normalize DOM-backed comment identities"
```

## Task 7: Gate QA And Resume On Both Sort Streams

**Files:**
- Modify: `src/pipeline/qa_comment_delivery.py`
- Modify: `src/pipeline/resume_comment_project.py`
- Modify: `test/pipeline/test_qa_comment_delivery.py`
- Modify: `test/pipeline/test_resume_comment_project.py`

**Interfaces:**
- Consumes: `capture-state.json.streams.hot` and `.time` plus normalized model-batch rows.
- Produces: issue codes `weibo_hot_stream_incomplete`, `weibo_time_stream_incomplete`, `weibo_missing_stable_comment_id`, and `weibo_level1_coverage_below_threshold`.
- Produces: a Weibo resume action naming the incomplete stream instead of redoing a verified stream.

- [ ] **Step 1: Write failing dual-stream QA and resume tests**

Add a QA fixture for a Weibo task with complete hot stream and incomplete time stream. Assert:

```python
self.assertEqual(task["status"], "partial")
self.assertIn("weibo_time_stream_incomplete", task["issues"])
```

Add a second fixture where both streams are verified, every normalized level-1 row has `comment_id`, the visible declared count is 10, and `unique_level1_count` is 8. Assert `status == "ok"` and `weibo_level1_coverage == 0.8`.

Add a resume test asserting an incomplete `time` stream produces exactly one action with `action == "resume_weibo_time_stream"` and does not schedule a hot-stream recapture.

- [ ] **Step 2: Run the Python tests and verify RED**

Run:

```bash
uv run --project src/pipeline python -m unittest test.pipeline.test_qa_comment_delivery test.pipeline.test_resume_comment_project
```

Expected: FAIL because stream-aware Weibo QA and resume actions do not exist.

- [ ] **Step 3: Implement stream-aware QA and selective resume**

Read stream fields only for `platform == 'weibo'`. A stream is complete only when `verified` is true, `stop_reason` is `page_end`, and `remaining_expand_count` is zero. Count unique level-1 DOM-backed rows by `comment_id`; calculate coverage only when the platform declaration is positive:

```python
coverage = unique_level1_count / declared_level1_count if declared_level1_count else None
```

Append the named issue codes for incomplete streams, missing stable IDs, or coverage below `COMMENT_COUNT_THRESHOLD`. Return `partial` for any of these issues and preserve the existing hard `failed` behavior for zero comments, login/verification blocks, or ambiguous roots.

In `resume_comment_project.py`, generate `resume_weibo_hot_stream` or `resume_weibo_time_stream` only for incomplete streams. Include the previous profile path and task URL in each action; never recommend an API fallback.

- [ ] **Step 4: Run the Python tests and verify GREEN**

Run:

```bash
uv run --project src/pipeline python -m unittest test.pipeline.test_qa_comment_delivery test.pipeline.test_resume_comment_project
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add src/pipeline/qa_comment_delivery.py src/pipeline/resume_comment_project.py test/pipeline/test_qa_comment_delivery.py test/pipeline/test_resume_comment_project.py
git commit -m "feat(weibo): gate dual-stream comment delivery"
```

## Task 8: Update Operating Rules And Run The End-To-End Pilot

**Files:**
- Modify: `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`
- Modify: `.codex/skills/comment-excel-delivery/SKILL.md`
- Modify: `.codex/skills/comment-excel-delivery/references/workflow.md`
- Modify: `test/pipeline/test_comment_excel_delivery_skill.py`
- Create at runtime, ignored: `output/weibo_chrome_pilot/`

**Interfaces:**
- Consumes: the completed capture, model, normalization, merge, QA, and Excel pipeline.
- Produces: an auditable pilot project whose `qa-summary.json.status` is `ok`, or a precisely scoped `partial`/`failed` artifact with no API fallback.

- [ ] **Step 1: Write failing documentation-contract tests**

In `test/pipeline/test_comment_excel_delivery_skill.py`, add assertions that the skill/workflow contain all of the following strings:

```python
for text in [
    "Weibo", "chrome:control-chrome", "按热度", "按时间",
    "source_comment_id", "partial", "do not bypass", "no MCP/API fallback"
]:
    self.assertIn(text, skill + "\n" + workflow)
```

Add a negative assertion that the Weibo rules no longer say “评论抓取优先走接口”.

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
uv run --project src/pipeline python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: FAIL because the current Weibo rules document API-first comments and the skill has no Weibo dual-stream rule.

- [ ] **Step 3: Update the operating documentation**

Replace the comment-collection section of `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md` with the Chrome/model pipeline from this plan. Keep the existing search and official-account post interface commands unchanged. State the exact `ok`, `partial`, and `failed` semantics, the profile-validation gate, model-batch limits, strict schema clone, and user-action rule for login/CAPTCHA.

Add a Weibo subsection to the delivery skill and workflow: Chrome plugin and model extraction are mandatory; only the explicit profile scope may be read; capture batches are evidence-only; model batches are 80 candidates/24,000 characters; no MCP/API fallback is permitted for Weibo comments.

- [ ] **Step 4: Run the documentation test and verify GREEN**

Run:

```bash
uv run --project src/pipeline python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: PASS.

- [ ] **Step 5: Run the Chrome/model pilot and verify the delivery gate**

Create `output/weibo_chrome_pilot/` with a small set of accessible TCL Weibo task URLs. For each task: validate the profile, capture both sort streams through Chrome, prepare model batches, run model extraction, normalize, merge, run QA, and build the existing report only if QA is `ok`.

Run the final verification suite:

```bash
node --test --test-reporter=dot test/*.test.js
uv run --project src/pipeline python -m unittest discover -s test/pipeline
python src/pipeline/qa_comment_delivery.py --project-dir output/weibo_chrome_pilot
git diff --check
```

Expected: all Node and Python tests pass; the pilot's `qa-summary.json` has `status: "ok"`, or it explicitly reports the recorded `partial`/`failed` reason without an API fallback.

- [ ] **Step 6: Commit Task 8**

Run:

```bash
git add docs/tcl_weibo_comment_workflow_rules_2026-07-07.md .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md test/pipeline/test_comment_excel_delivery_skill.py
git commit -m "docs(weibo): document chrome-only comment workflow"
```

## Plan Self-Review

- Scope coverage: Tasks 1–3 implement the profile/safe Chrome capture boundary; Task 4 separates browser and model batches; Task 5 handles strict model schema compatibility; Task 6 guarantees deterministic identity and merge; Task 7 implements `ok`/`partial`/`failed` and selective resume; Task 8 updates legacy rules and verifies the real pipeline.
- Cross-task interfaces: capture artifacts remain `comment-dom-batch-v1`; only `batch_kind` separates evidence and model material. Model output refers to `candidate_id`; normalizer is the sole writer of comment identity. QA consumes capture stream state and normalized rows.
- External dependency: real selector values are intentionally runtime profile data collected through Chrome in Task 1. The code never invents or falls back to a selector, interface, or text-based comment identity.

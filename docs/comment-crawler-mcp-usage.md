# Chrome default comment capture workflow

更新时间：2026-07-09

## 1. Default workflow

Chrome is the default browser execution surface for comment capture. Use `chrome:control-chrome` when a task depends on the user's logged-in Chrome session, visible platform state, or browser extension control.

The default flow is:

1. Parse task links into `output/<project_id>/crawl-tasks.json`.
2. Normalize Douyin `user?...modal_id=...` links to `/video/<modal_id>` before opening the task.
3. Use `chrome:control-chrome` to open each normalized task URL in a fresh tab.
4. Let Codex automate visible comment expansion, reply expansion, scrolling, and DOM inspection through Chrome.
5. Stop for user action when login, CAPTCHA, verification, privacy consent, or platform access checks appear. Do not bypass those checks.
6. Save visible DOM candidates as `comment-dom-batch-v1` files under the existing batch paths.
7. Run AI extraction, normalization, task merge, project merge, QA, and Excel generation with the existing commands.

## 2. Chrome per-task sequence

For each task directory:

```text
output/<project_id>/runs/<task_id>/
  task.json
```

Run the browser part in a fresh Chrome tab:

1. Connect to Chrome using the `chrome:control-chrome` skill.
2. If a Douyin URL has the form `user?...modal_id=...`, extract `modal_id` and navigate to `/video/<modal_id>` instead of the user page.
3. Confirm that the current page is the intended Douyin or Xiaohongshu page.
4. If login, CAPTCHA, verification, or consent UI appears, pause and ask the user to complete it in Chrome.
5. Click visible expand controls such as `展开更多`, `展开 N 条回复`, comments, or replies.
6. Capture the current visible comment candidate DOM before scrolling.
7. Scroll the comment area or detail pane, not the Douyin short-video feed. Scrolling the short-video feed can switch to the next video.
8. Use a tab cleanup guard around expand and comment-area clicks. Compare `browser.tabs.list()` before and after each click batch; if a commenter profile, creator profile, `/user/` page, or other non-task page opens, close the accidental tab and return to the task tab.
9. Repeat bounded rounds until idle, navigation away, verification, or configured limits.
10. Close or finalize the task tab before moving to the next task.

## 3. Douyin modal links and tab cleanup

Douyin user profile URLs can carry the actual video id in `modal_id`, for example `user?...modal_id=...`. Treat these as detail-video tasks:

1. Parse `modal_id` from the URL.
2. Build `/video/<modal_id>` as the navigation target.
3. Confirm the opened title and URL match the intended video.
4. Scroll only the comment container on the detail page. Do not scroll the short-video feed.

Some comment UIs open user pages when an avatar, username, commenter profile, or creator profile is clicked accidentally. Add a tab cleanup guard:

1. Keep the task tab id.
2. Call `browser.tabs.list()` before risky clicks.
3. Call `browser.tabs.list()` after the click batch.
4. For any newly opened tab that is not the task detail page, close the accidental tab.
5. If the task tab navigated to a profile page, reopen the normalized task URL before capture.

## 4. Chrome DOM batch shape

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

## 5. Chrome control example

The exact Chrome API is provided by the `chrome:control-chrome` skill. A production run must read that skill first. The browser client exposes Playwright-compatible page access through `tab.playwright`; use that surface to inspect, click, scroll, and extract bounded DOM candidates.

```javascript
const tab = await browser.tabs.new();
const targetUrl = normalizeDouyinModalUrl(task.source_url);
await tab.goto(targetUrl);

const page = tab.playwright;
await page.waitForLoadState('domcontentloaded');

const blockedText = await page.locator('body').innerText({ timeout: 5000 });
if (/登录|验证码|CAPTCHA|验证|隐私|同意/.test(blockedText)) {
  throw new Error('Page requires user action for login, CAPTCHA, verification, or consent.');
}

for (const label of ['展开更多', '展开回复', '查看更多回复']) {
  const beforeTabs = await browser.tabs.list();
  const buttons = await page.getByText(label, { exact: false }).all();
  for (const button of buttons.slice(0, 3)) {
    await button.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(900);
  }
  const afterTabs = await browser.tabs.list();
  await closeAccidentalProfileTabs(beforeTabs, afterTabs, tab);
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

await scrollCommentContainerOnly(page);
await page.waitForTimeout(1200);
```

This example demonstrates the expected Chrome control pattern. The saved file still must be a valid `comment-dom-batch-v1` batch with stable candidate hashes and capture state.

## 6. AI extraction and normalization

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

Project merge, QA, batch summary, and Excel generation remain the same commands used by `comment-excel-delivery`.

## 7. MCP/CDP fallback

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

## 8. Troubleshooting

| Symptom | Likely Cause | Action |
|---|---|---|
| Chrome control cannot find a usable tab | No fresh tab was opened for the task | Open a new task tab through `chrome:control-chrome` and navigate to `task.source_url` |
| Douyin task opens the short-video feed | Source URL was `user?...modal_id=...` | Extract `modal_id`, reopen `/video/<modal_id>`, and scroll the comment container |
| A profile tab opens while expanding comments | Avatar, username, commenter profile, or creator profile was clicked | Use the tab cleanup guard and close the accidental tab |
| Captured candidates are login or consent text | The platform blocked the page behind login, CAPTCHA, verification, or consent UI | Pause for user action in Chrome, then continue the same task |
| Downstream normalizer fails | Batch is not compatible with `comment-dom-batch-v1` | Check candidate fields and do not use `chrome-dom-batch.json` |
| MCP fallback attaches to the wrong page | Old CDP tab remained selected | Use `sourceUrl` when calling fallback tools and keep `closePageAfter` enabled on final capture |
| Project merge misses a task | Task-level `normalized-comments.jsonl` was not written | Run `merge_task_batches.py` after all batch normalizations |

## 9. Safety boundary

- Do not read cookies, passwords, or account secrets.
- Do not bypass platform risk controls, login, CAPTCHA, verification, or consent UI.
- Do not scrape from unrelated substitute sources.
- Do not run multiple platform pages in parallel for one task.
- Do not leave accidental profile tabs open after a task click.
- Do not write results outside the project `output/` directory.
- AI only processes saved DOM batches and never operates page clicks, scrolling, or authentication.

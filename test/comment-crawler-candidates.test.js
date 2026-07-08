'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const candidates = require('../mcp/comment-crawler-candidates.js');

function makeElement(options) {
  const attrs = Object.assign({}, options.attrs);
  const rect = Object.assign({
    top: 0,
    left: 0,
    width: 320,
    height: 80
  }, options.rect);

  return {
    tagName: options.tagName || 'DIV',
    id: options.id || '',
    className: options.className || '',
    textContent: options.text || '',
    innerText: options.text || '',
    outerHTML: options.html || `<div>${options.text || ''}</div>`,
    previousElementSibling: options.previousElementSibling || null,
    parentElement: options.parentElement || null,
    getAttribute(name) {
      return attrs[name] || '';
    },
    getBoundingClientRect() {
      return Object.assign({}, rect, {
        bottom: rect.top + rect.height,
        right: rect.left + rect.width
      });
    },
    querySelectorAll(selector) {
      if (selector === 'button,[role="button"],a') {
        return (options.buttons || []).map(text => makeElement({ text }));
      }
      return [];
    }
  };
}

test('builds a bounded visible comment candidate batch', () => {
  const footer = makeElement({
    className: 'comment-footer',
    text: '沪ICP备13030189号 | 营业执照',
    rect: { top: 100, height: 40 }
  });
  const hiddenComment = makeElement({
    className: 'comment-item',
    text: '屏幕外评论不应该进入 batch',
    rect: { top: 1400, height: 80 }
  });
  const firstComment = makeElement({
    className: 'comment-item',
    text: '用户A 第一条评论 3月前 江苏 2',
    html: '<div class="comment-item"><script>bad()</script><span>用户A 第一条评论</span></div>',
    buttons: ['回复'],
    rect: { top: 120, left: 20, width: 420, height: 88 }
  });
  const firstDuplicate = makeElement({
    className: 'comment-item',
    text: '用户A 第一条评论 3月前 江苏 2',
    rect: { top: 220, left: 20, width: 420, height: 88 }
  });
  const reply = makeElement({
    className: 'reply-item',
    text: '用户B 回复内容 2月前 上海 1',
    html: '<div class="reply-item"><svg></svg><span>用户B 回复内容</span></div>',
    buttons: ['展开 3 条回复'],
    rect: { top: 320, left: 44, width: 380, height: 70 }
  });
  const extraComment = makeElement({
    className: 'comment-item',
    text: '第三条评论因为 maxCandidates 被截断',
    rect: { top: 450, height: 80 }
  });

  const batch = candidates.buildCommentDomBatchFromElements([
    footer,
    hiddenComment,
    firstComment,
    firstDuplicate,
    reply,
    extraComment
  ], {
    taskId: 'task_0001',
    batchId: 'batch_0001',
    platform: 'douyin',
    sourceUrl: 'https://www.douyin.com/video/123',
    maxCandidates: 2,
    maxCharsPerCandidate: 18,
    viewportHeight: 900,
    documentHeight: 5000,
    beforeTop: 1000,
    afterTop: 1600,
    capturedAt: '2026-07-08T05:00:00.000Z'
  });

  assert.equal(batch.schema_version, 'comment-dom-batch-v1');
  assert.equal(batch.task_id, 'task_0001');
  assert.equal(batch.batch_id, 'batch_0001');
  assert.equal(batch.candidates.length, 2);
  assert.equal(batch.state.new_candidate_count, 2);
  assert.equal(batch.state.has_more, true);
  assert.deepEqual(batch.candidates.map(candidate => candidate.role_hint), [
    'comment_candidate',
    'reply_candidate'
  ]);
  assert.equal(batch.candidates[0].candidate_id, 'candidate_000001');
  assert.equal(batch.candidates[0].inner_text.length <= 18, true);
  assert.equal(batch.candidates[0].html.includes('<script'), false);
  assert.equal(batch.candidates[1].html.includes('<svg'), false);
  assert.deepEqual(batch.candidates[0].nearby_buttons, ['回复']);
  assert.deepEqual(batch.candidates[0].rect, {
    top: 120,
    left: 20,
    width: 420,
    height: 88
  });
});

test('skips candidates already present in seen hashes', () => {
  const first = makeElement({
    className: 'comment-item',
    text: '用户A 第一条评论',
    rect: { top: 120, height: 80 }
  });
  const existing = candidates.buildCommentDomBatchFromElements([first], {
    taskId: 'task_0001',
    batchId: 'batch_0001',
    viewportHeight: 900
  });
  const seenHash = existing.candidates[0].candidate_hash;

  const next = candidates.buildCommentDomBatchFromElements([first], {
    taskId: 'task_0001',
    batchId: 'batch_0002',
    viewportHeight: 900,
    seenCandidateHashes: [seenHash]
  });

  assert.equal(next.candidates.length, 0);
  assert.equal(next.state.new_candidate_count, 0);
  assert.equal(next.state.seen_candidate_count, 1);
  assert.equal(next.state.has_more, false);
});

test('normalizes candidate options to safe defaults', () => {
  assert.deepEqual(candidates.normalizeCandidateOptions({
    maxCandidates: -1,
    maxCharsPerCandidate: 'bad',
    includeHtml: false
  }), {
    taskId: '',
    batchId: '',
    platform: 'unknown',
    sourceUrl: '',
    maxCandidates: candidates.DEFAULT_MAX_CANDIDATES,
    maxCharsPerCandidate: candidates.DEFAULT_MAX_CHARS_PER_CANDIDATE,
    includeHtml: false,
    includeText: true,
    viewportHeight: 0,
    documentHeight: 0,
    beforeTop: 0,
    afterTop: 0,
    seenCandidateHashes: []
  });
});

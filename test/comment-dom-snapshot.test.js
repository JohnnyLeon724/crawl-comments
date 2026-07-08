'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const domSnapshot = require('../mcp/comment-crawler-dom-snapshot.js');

function makeElement(options) {
  const attrs = Object.assign({}, options.attrs);
  return {
    id: options.id || '',
    className: options.className || '',
    textContent: options.text || '',
    innerText: options.text || '',
    outerHTML: options.html || `<div>${options.text || ''}</div>`,
    getAttribute(name) {
      return attrs[name] || '';
    },
    querySelectorAll(selector) {
      if (selector === 'button,[role="button"],a') {
        return (options.buttons || []).map(text => makeElement({ text }));
      }
      return [];
    }
  };
}

test('builds bounded DOM snapshot chunks while filtering obvious page noise', () => {
  const legalFooter = makeElement({
    className: 'footer comment-footer',
    text: '沪ICP备13030189号 | 营业执照 | 电话：9501-3888'
  });
  const playerControls = makeElement({
    className: 'comment-player',
    text: '00:0006:382x1.5x1x0.75x0.5x倍速 2K 高帧率 请刷新试试'
  });
  const firstComment = makeElement({
    className: 'comment-item',
    text: '托马斯这是我用到现在最好的轮胎置顶评论04-04上海24',
    html: '<div class="comment-item"><script>bad()</script><span>托马斯这是我用到现在最好的轮胎</span></div>',
    buttons: ['回复']
  });
  const secondComment = makeElement({
    className: 'reply-item',
    text: 'Henry的平行宇宙作者哟，主角来了 这个评价相当高啊！04-04上海1回复',
    html: '<div class="reply-item"><svg></svg><span>Henry的平行宇宙作者哟，主角来了</span></div>',
    buttons: ['展开 3 条']
  });
  const thirdComment = makeElement({
    className: 'comment-item',
    text: '第三条评论应该因为 maxChunks 被截断'
  });

  const snapshot = domSnapshot.buildCommentDomSnapshotFromElements([
    legalFooter,
    playerControls,
    firstComment,
    secondComment,
    thirdComment
  ], {
    platform: 'xiaohongshu',
    sourceUrl: 'https://www.xiaohongshu.com/explore/abc',
    maxChunks: 2,
    maxCharsPerChunk: 24,
    capturedAt: '2026-07-08T05:00:00.000Z'
  });

  assert.equal(snapshot.schema_version, 'comment-dom-snapshot-v1');
  assert.equal(snapshot.platform, 'xiaohongshu');
  assert.equal(snapshot.chunks.length, 2);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.chunks[0].chunk_id, 'chunk_0001');
  assert.equal(snapshot.chunks[0].inner_text.length <= 24, true);
  assert.equal(snapshot.chunks[0].html.includes('<script'), false);
  assert.equal(snapshot.chunks[1].html.includes('<svg'), false);
  assert.deepEqual(snapshot.chunks.map(chunk => chunk.role_hint), [
    'comment_candidate',
    'comment_candidate'
  ]);
  assert.deepEqual(snapshot.chunks[0].nearby_buttons, ['回复']);
});

test('normalizes snapshot options to safe positive limits', () => {
  assert.deepEqual(domSnapshot.normalizeSnapshotOptions({
    maxChunks: -1,
    maxCharsPerChunk: 'bad',
    includeHtml: false
  }), {
    platform: 'unknown',
    sourceUrl: '',
    maxChunks: domSnapshot.DEFAULT_MAX_CHUNKS,
    maxCharsPerChunk: domSnapshot.DEFAULT_MAX_CHARS_PER_CHUNK,
    includeHtml: false,
    includeText: true
  });
});

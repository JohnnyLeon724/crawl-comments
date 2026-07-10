'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const weibo = require('../src/adapters/weibo.js');

test('extracts a stable post ID from supported canonical Weibo detail URLs', () => {
  assert.equal(
    weibo.extractWeiboPostId('https://weibo.com/1812511057/Pa1Bc2D3e?refer_flag=1001030103_'),
    '1812511057/Pa1Bc2D3e'
  );
  assert.equal(
    weibo.extractWeiboPostId('https://www.weibo.com/detail/Pa1Bc2D3e#comment'),
    'detail/Pa1Bc2D3e'
  );
});

test('rejects unsupported or malformed Weibo URL shapes', () => {
  for (const sourceUrl of [
    '',
    'https://example.com/1812511057/Pa1Bc2D3e',
    'https://weibo.com/1812511057',
    'https://weibo.com/detail',
    'https://weibo.com/1812511057/Pa1Bc2D3e/extra',
    'weibo.com/1812511057/Pa1Bc2D3e'
  ]) {
    assert.equal(weibo.extractWeiboPostId(sourceUrl), '', sourceUrl);
  }
});

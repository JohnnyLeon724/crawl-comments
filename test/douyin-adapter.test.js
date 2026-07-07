'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../schemas/comment-row.schema.json');
const douyin = require('../adapters/douyin.js');

function assertMatchesCommentRowSchema(row) {
  for (const field of schema.required) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, field), `${field} should exist`);
  }
  assert.equal(schema.properties.platform.enum.includes(row.platform), true);
  assert.equal(schema.properties.row_type.enum.includes(row.row_type), true);
  assert.equal(typeof row.raw, 'object');
}

test('normalizes expander payload results into standard comment rows', () => {
  const rows = douyin.normalizeDouyinPayload({
    results: [
      {
        row_type: 'level1',
        text: '用户A：TCL电视画质不错 回复 展开3条回复',
        dom_path: 'DIV:nth-of-type(1)',
        captured_at: '2026-07-07T00:00:00.000Z'
      },
      {
        row_type: 'level2',
        text: '用户B：售后一直没人处理 点赞 2',
        dom_path: 'DIV:nth-of-type(2)',
        captured_at: '2026-07-07T00:00:01.000Z'
      },
      {
        row_type: 'level1',
        text: '   ',
        dom_path: 'DIV:nth-of-type(3)',
        captured_at: '2026-07-07T00:00:02.000Z'
      }
    ]
  }, {
    sourceUrl: 'https://www.douyin.com/video/7123456789'
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.user_name), ['用户A', '用户B']);
  assert.deepEqual(rows.map(row => row.text), ['TCL电视画质不错', '售后一直没人处理']);
  assert.deepEqual(rows.map(row => row.row_type), ['level1', 'level2']);
  assert.equal(rows[0].platform, 'douyin');
  assert.equal(rows[0].post_id, '7123456789');
  assert.equal(rows[0].created_at, '2026-07-07T00:00:00.000Z');

  for (const row of rows) {
    assertMatchesCommentRowSchema(row);
  }
});

test('dedupes normalized comments with stable row keys', () => {
  const payload = {
    results: [
      { row_type: 'level1', text: '用户A：重复评论', dom_path: 'A', captured_at: 't1' },
      { row_type: 'level1', text: '用户A：重复评论', dom_path: 'B', captured_at: 't2' }
    ]
  };

  const first = douyin.normalizeDouyinPayload(payload, {
    sourceUrl: 'https://www.douyin.com/video/1'
  });
  const second = douyin.normalizeDouyinPayload(payload, {
    sourceUrl: 'https://www.douyin.com/video/1'
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].row_key, second[0].row_key);
});

test('extracts Douyin post IDs from common URL shapes', () => {
  assert.equal(
    douyin.extractDouyinPostId('https://www.douyin.com/video/7123456789?previous_page=app_code_link'),
    '7123456789'
  );
  assert.equal(
    douyin.extractDouyinPostId('https://www.douyin.com/note/99887766'),
    '99887766'
  );
});

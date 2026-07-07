'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const xiaohongshu = require('../adapters/xiaohongshu.js');
const normalizer = require('../script/normalize-comments.js');

test('extracts Xiaohongshu note IDs from common URL shapes', () => {
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('https://www.xiaohongshu.com/explore/64aa11bb000000001203abcd?xsec_token=abc'),
    '64aa11bb000000001203abcd'
  );
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('https://www.xiaohongshu.com/search_result/64aa11bb000000001203abcd?xsec_token=abc'),
    '64aa11bb000000001203abcd'
  );
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('https://www.xiaohongshu.com/note/64aa11bb000000001203abcd'),
    '64aa11bb000000001203abcd'
  );
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('https://www.xiaohongshu.com/discovery/item/64aa11bb000000001203abcd'),
    '64aa11bb000000001203abcd'
  );
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('https://www.xiaohongshu.com/user/profile/user123/64aa11bb000000001203abcd?xsec_token=abc'),
    '64aa11bb000000001203abcd'
  );
  assert.equal(
    xiaohongshu.extractXiaohongshuNoteId('64aa11bb000000001203abcd'),
    '64aa11bb000000001203abcd'
  );
});

test('parses Xiaohongshu like counts like the comments CLI', () => {
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('42'), 42);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('1,234'), 1234);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('1，234+'), 1234);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('2.1w'), 21000);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('1.5万'), 15000);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('1.2k'), 1200);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('3千'), 3000);
  assert.equal(xiaohongshu.parseXiaohongshuLikeCountText('likes 2.1w'), 0);
});

test('strips Xiaohongshu comment UI text', () => {
  assert.equal(
    xiaohongshu.stripXiaohongshuUiText('用户A：这台电视不错 回复 赞 3 展开 2 条回复'),
    '用户A：这台电视不错'
  );
  assert.equal(
    xiaohongshu.stripXiaohongshuUiText('查看更多回复'),
    ''
  );
});

test('normalizes Xiaohongshu payload rows into standard comment rows', () => {
  const rows = xiaohongshu.normalizeXiaohongshuPayload({
    source_url: 'https://www.xiaohongshu.com/explore/64aa11bb000000001203abcd',
    results: [
      {
        row_type: 'level1',
        text: '用户A：画质不错 回复 赞 3',
        captured_at: '2026-07-07T00:00:00.000Z'
      },
      {
        row_type: 'level2',
        text: '用户B：售后没人处理 展开 2 条回复',
        captured_at: '2026-07-07T00:00:01.000Z'
      }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].platform, 'xiaohongshu');
  assert.equal(rows[0].post_id, '64aa11bb000000001203abcd');
  assert.equal(rows[0].user_name, '用户A');
  assert.equal(rows[0].text, '画质不错');
  assert.equal(rows[0].like_count, 3);
  assert.equal(rows[1].row_type, 'level2');
  assert.equal(rows[1].text, '售后没人处理');
});

test('normalizes rows returned by clis/xiaohongshu/comments.js', () => {
  const rows = xiaohongshu.normalizeXiaohongshuPayload({
    source_url: 'https://www.xiaohongshu.com/search_result/64aa11bb000000001203abcd?xsec_token=abc',
    results: [
      {
        rank: 1,
        author: 'Alice',
        userId: 'abc123',
        profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123',
        text: 'Main comment',
        likes: '2.1w',
        time: '03-25',
        is_reply: false,
        reply_to: ''
      },
      {
        rank: 2,
        author: 'Bob',
        userId: 'xyz789',
        profileUrl: 'https://www.xiaohongshu.com/user/profile/xyz789',
        text: 'Reply to Alice',
        likes: 3,
        time: '03-25',
        is_reply: true,
        reply_to: 'Alice'
      }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].user_name, 'Alice');
  assert.equal(rows[0].text, 'Main comment');
  assert.equal(rows[0].like_count, 21000);
  assert.equal(rows[0].created_at, '03-25');
  assert.equal(rows[0].raw.userId, 'abc123');
  assert.equal(rows[1].row_type, 'level2');
  assert.equal(rows[1].reply_to_user_name, 'Alice');
  assert.equal(rows[1].like_count, 3);
});

test('normalizer routes Xiaohongshu platform to the adapter', () => {
  const rows = normalizer.normalizePayload({
    source_url: 'https://www.xiaohongshu.com/explore/64aa11bb000000001203abcd',
    results: [
      {
        row_type: 'level1',
        text: '用户A：画质不错',
        captured_at: '2026-07-07T00:00:00.000Z'
      }
    ]
  }, {
    platform: 'xiaohongshu'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'xiaohongshu');
  assert.equal(rows[0].text, '画质不错');
});

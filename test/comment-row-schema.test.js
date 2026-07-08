'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../schemas/comment-row.schema.json');

test('comment row schema defines the normalized row contract', () => {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);

  const required = new Set(schema.required);
  for (const field of [
    'row_key',
    'platform',
    'source_url',
    'row_type',
    'text',
    'raw'
  ]) {
    assert.equal(required.has(field), true, `${field} should be required`);
  }
});

test('comment row schema supports planned platforms and comment levels', () => {
  assert.deepEqual(schema.properties.platform.enum, [
    'douyin',
    'xiaohongshu',
    'weibo',
    'unknown'
  ]);

  assert.deepEqual(schema.properties.row_type.enum, [
    'level1',
    'level2'
  ]);
});

test('comment row schema includes fields required by AI and Excel stages', () => {
  for (const field of [
    'post_id',
    'comment_id',
    'root_comment_id',
    'parent_comment_id',
    'user_name',
    'created_at',
    'like_count',
    'reply_to_user_name',
    'root_text'
  ]) {
    assert.ok(schema.properties[field], `${field} should be present`);
  }
});

test('comment row schema includes optional client task context fields', () => {
  for (const field of [
    'task_id',
    'phase',
    'source_excel_row',
    'source_index',
    'creator_name',
    'published_at_text',
    'source_engagement_count',
    'source_expected_comment_count'
  ]) {
    assert.ok(schema.properties[field], `${field} should be present`);
  }
});

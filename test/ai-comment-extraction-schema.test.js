'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../schemas/ai-comment-extraction.schema.json');

test('AI comment extraction schema defines extraction envelope', () => {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);

  const required = new Set(schema.required);
  for (const field of [
    'schema_version',
    'source_url',
    'rows',
    'rejected'
  ]) {
    assert.equal(required.has(field), true, `${field} should be required`);
  }

  assert.equal(schema.properties.schema_version.const, 'ai-comment-extraction-v1');
  assert.equal(schema.properties.platform.enum.includes('weibo'), true);
});

test('AI comment extraction rows preserve comment structure and source chunk', () => {
  const row = schema.properties.rows.items;
  assert.equal(row.type, 'object');
  assert.equal(row.additionalProperties, false);

  for (const field of [
    'source_chunk_id',
    'row_type',
    'user_name',
    'text',
    'created_at',
    'ip_location',
    'like_count',
    'reply_to_user_name',
    'root_text',
    'is_pinned',
    'is_author',
    'confidence',
    'evidence'
  ]) {
    assert.equal(row.required.includes(field), true, `${field} should be required`);
  }

  assert.deepEqual(row.properties.row_type.enum, ['level1', 'level2']);
  assert.deepEqual(row.properties.confidence.enum, ['high', 'medium', 'low']);
  assert.equal(row.properties.like_count.minimum, 0);
});

test('AI comment extraction schema records rejected chunks with reasons', () => {
  const rejected = schema.properties.rejected.items;
  assert.equal(rejected.type, 'object');
  assert.equal(rejected.additionalProperties, false);
  assert.equal(rejected.required.includes('source_chunk_id'), true);
  assert.equal(rejected.required.includes('reason'), true);
});

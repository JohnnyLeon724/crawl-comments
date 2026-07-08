'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../schemas/comment-dom-snapshot.schema.json');

test('comment DOM snapshot schema defines bounded snapshot metadata', () => {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);

  const required = new Set(schema.required);
  for (const field of [
    'schema_version',
    'platform',
    'source_url',
    'captured_at',
    'limits',
    'chunks'
  ]) {
    assert.equal(required.has(field), true, `${field} should be required`);
  }

  assert.deepEqual(schema.properties.platform.enum, [
    'douyin',
    'xiaohongshu',
    'unknown'
  ]);
});

test('comment DOM snapshot schema constrains chunk shape and roles', () => {
  const chunk = schema.properties.chunks.items;
  assert.equal(chunk.type, 'object');
  assert.equal(chunk.additionalProperties, false);

  for (const field of [
    'chunk_id',
    'dom_path',
    'role_hint',
    'inner_text',
    'html',
    'nearby_buttons',
    'captured_at'
  ]) {
    assert.equal(chunk.required.includes(field), true, `${field} should be required`);
  }

  assert.deepEqual(chunk.properties.role_hint.enum, [
    'comment_candidate',
    'comment_region',
    'unknown'
  ]);
  assert.equal(chunk.properties.nearby_buttons.type, 'array');
});

test('comment DOM snapshot schema declares limits for token control', () => {
  const limits = schema.properties.limits;
  assert.equal(limits.type, 'object');
  assert.equal(limits.required.includes('maxChunks'), true);
  assert.equal(limits.required.includes('maxCharsPerChunk'), true);
  assert.equal(limits.properties.maxChunks.minimum, 1);
  assert.equal(limits.properties.maxCharsPerChunk.minimum, 1);
});

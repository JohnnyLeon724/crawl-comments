'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../schemas/comment-dom-batch.schema.json');

test('comment DOM batch schema defines batch-level metadata', () => {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema_version.const, 'comment-dom-batch-v1');

  const required = new Set(schema.required);
  for (const field of [
    'schema_version',
    'batch_id',
    'task_id',
    'platform',
    'source_url',
    'captured_at',
    'scroll',
    'state',
    'limits',
    'candidates'
  ]) {
    assert.equal(required.has(field), true, `${field} should be required`);
  }

  assert.deepEqual(schema.properties.platform.enum, [
    'douyin',
    'xiaohongshu',
    'bilibili',
    'unknown'
  ]);
});

test('comment DOM batch schema constrains scroll, state, and limits', () => {
  const scroll = schema.properties.scroll;
  assert.deepEqual(scroll.required, [
    'before_top',
    'after_top',
    'viewport_height',
    'document_height'
  ]);
  assert.equal(scroll.properties.before_top.minimum, 0);
  assert.equal(scroll.properties.document_height.minimum, 0);

  const state = schema.properties.state;
  assert.equal(state.required.includes('new_candidate_count'), true);
  assert.equal(state.required.includes('seen_candidate_count'), true);
  assert.equal(state.required.includes('has_more'), true);
  assert.equal(state.properties.new_candidate_count.minimum, 0);

  const limits = schema.properties.limits;
  assert.equal(limits.required.includes('maxCandidates'), true);
  assert.equal(limits.required.includes('maxCharsPerCandidate'), true);
  assert.equal(limits.properties.maxCandidates.minimum, 1);
});

test('comment DOM batch schema constrains candidate shape', () => {
  const candidate = schema.properties.candidates.items;
  assert.equal(candidate.type, 'object');
  assert.equal(candidate.additionalProperties, false);

  for (const field of [
    'candidate_id',
    'candidate_hash',
    'dom_path',
    'role_hint',
    'inner_text',
    'html',
    'nearby_buttons',
    'rect',
    'captured_at'
  ]) {
    assert.equal(candidate.required.includes(field), true, `${field} should be required`);
  }

  assert.deepEqual(candidate.properties.role_hint.enum, [
    'comment_candidate',
    'reply_candidate',
    'unknown'
  ]);
  assert.equal(candidate.properties.rect.required.includes('top'), true);
  assert.equal(candidate.properties.nearby_buttons.type, 'array');
});

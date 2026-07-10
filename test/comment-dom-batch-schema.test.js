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
    'weibo',
    'unknown'
  ]);
  assert.deepEqual(schema.properties.batch_kind.enum, ['capture', 'model']);
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

  for (const field of [
    'declared_comment_count',
    'captured_record_count',
    'remaining_expand_count',
    'end_signal',
    'count_gap'
  ]) {
    assert.equal(Boolean(state.properties[field]), true, `${field} should be supported`);
  }
  assert.equal(state.properties.declared_comment_count.minimum, 0);
  assert.equal(state.properties.count_gap.minimum, 0);

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

  for (const field of [
    'capture_sort_mode',
    'identity_mode',
    'source_comment_id',
    'source_parent_comment_id',
    'source_root_comment_id',
    'source_composite_fingerprint',
    'source_author_uid_href',
    'source_comment_text',
    'source_comment_timestamp',
    'source_reply_context',
    'source_root_context',
    'source_capture_batch_ids'
  ]) {
    assert.equal(Boolean(candidate.properties[field]), true, `${field} should be supported`);
  }
  assert.deepEqual(candidate.properties.capture_sort_mode.enum, ['hot', 'time']);
  assert.deepEqual(candidate.properties.identity_mode.enum, [
    'dom_id',
    'composite_fingerprint'
  ]);
  assert.equal(candidate.properties.source_capture_batch_ids.type, 'array');
});

test('rejects composite candidates without all public identity evidence', () => {
  const compositeRule = schema.properties.candidates.items.allOf.find(rule => (
    rule.if?.properties?.identity_mode?.const === 'composite_fingerprint'
  ));

  assert.ok(compositeRule, 'schema needs a composite-fingerprint conditional rule');
  assert.deepEqual(compositeRule.then.required, [
    'source_author_uid_href',
    'source_comment_text',
    'source_comment_timestamp',
    'source_reply_context',
    'source_root_context',
    'source_composite_fingerprint'
  ]);
  assert.deepEqual(compositeRule.then.properties.source_author_uid_href, {
    type: 'string',
    minLength: 1
  });
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const prep = require('../src/normalize/prepare-comment-extraction-batches.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function candidate(overrides = {}) {
  return Object.assign({
    candidate_id: 'candidate_001',
    candidate_hash: 'hash_001',
    dom_path: 'article:nth-child(1)',
    role_hint: 'comment_candidate',
    inner_text: '一条评论',
    html: '<article>一条评论</article>',
    nearby_buttons: [],
    rect: { top: 0, left: 0, width: 100, height: 20 },
    captured_at: '2026-07-10T00:00:00.000Z',
    source_capture_batch_ids: []
  }, overrides);
}

function captureBatch(batchId, candidates, overrides = {}) {
  return Object.assign({
    schema_version: 'comment-dom-batch-v1',
    batch_id: batchId,
    task_id: 'task_0001',
    platform: 'weibo',
    batch_kind: 'capture',
    source_url: 'https://weibo.com/detail/123',
    captured_at: '2026-07-10T00:00:00.000Z',
    scroll: { before_top: 0, after_top: 100, viewport_height: 500, document_height: 1000 },
    state: { new_candidate_count: candidates.length, seen_candidate_count: candidates.length, has_more: false, stop_reason: 'page_end' },
    limits: { maxCandidates: 500, maxCharsPerCandidate: 8000 },
    candidates
  }, overrides);
}

function writeCapture(taskDir, batchId, candidates, overrides) {
  writeJson(
    path.join(taskDir, 'batches', batchId, 'comment-dom-batch.json'),
    captureBatch(batchId, candidates, overrides)
  );
}

test('merges duplicate DOM-ID candidates from capture sort streams deterministically', () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-batches-dom-id-'));
  writeCapture(taskDir, 'capture_hot_001', [
    candidate({
      candidate_id: 'weibo:comment-1',
      candidate_hash: 'hot-1',
      identity_mode: 'dom_id',
      source_comment_id: 'comment-1',
      source_capture_batch_ids: ['capture_hot_001']
    }),
    candidate({
      candidate_id: 'weibo:comment-2',
      candidate_hash: 'hot-2',
      identity_mode: 'dom_id',
      source_comment_id: 'comment-2',
      source_capture_batch_ids: ['capture_hot_001']
    })
  ]);
  writeCapture(taskDir, 'capture_time_001', [
    candidate({
      candidate_id: 'weibo:comment-1',
      candidate_hash: 'time-1',
      identity_mode: 'dom_id',
      source_comment_id: 'comment-1',
      source_capture_batch_ids: ['capture_time_001']
    })
  ]);

  const result = prep.prepareModelBatches({ taskDir, maxCandidates: 2, maxTextChars: 1000 });

  assert.equal(result.captureCandidateCount, 3);
  assert.equal(result.uniqueCandidateCount, 2);
  assert.equal(result.modelBatchCount, 1);
  const batch = JSON.parse(fs.readFileSync(result.modelBatchPaths[0], 'utf8'));
  assert.equal(batch.batch_kind, 'model');
  assert.deepEqual(batch.candidates[0].source_capture_batch_ids, ['capture_hot_001', 'capture_time_001']);
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.deepEqual(manifest.source_capture_batch_ids, ['capture_hot_001', 'capture_time_001']);
  assert.deepEqual(manifest.identity_mode_counts, { dom_id: 2 });
});

test('merges composite candidates without inventing a comment ID', () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-batches-composite-'));
  const shared = {
    candidate_id: 'weibo:fp:sha256:abc',
    candidate_hash: 'fingerprint-hash',
    identity_mode: 'composite_fingerprint',
    source_composite_fingerprint: 'sha256:abc'
  };
  writeCapture(taskDir, 'capture_hot_001', [candidate(Object.assign({}, shared, {
    source_capture_batch_ids: ['capture_hot_001']
  }))]);
  writeCapture(taskDir, 'capture_time_001', [candidate(Object.assign({}, shared, {
    source_capture_batch_ids: ['capture_time_001']
  }))]);

  const result = prep.prepareModelBatches({ taskDir });
  const batch = JSON.parse(fs.readFileSync(result.modelBatchPaths[0], 'utf8'));

  assert.equal(result.uniqueCandidateCount, 1);
  assert.equal(batch.candidates[0].identity_mode, 'composite_fingerprint');
  assert.equal(batch.candidates[0].source_comment_id, undefined);
  assert.deepEqual(batch.candidates[0].source_capture_batch_ids, ['capture_hot_001', 'capture_time_001']);
});

test('starts a new model batch before a candidate exceeds the text limit', () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-batches-text-limit-'));
  writeCapture(taskDir, 'capture_hot_001', [
    candidate({ candidate_id: 'one', candidate_hash: 'one', inner_text: '12345678' }),
    candidate({ candidate_id: 'two', candidate_hash: 'two', inner_text: 'abcdefgh' }),
    candidate({ candidate_id: 'three', candidate_hash: 'three', inner_text: 'ABCDEFGH' })
  ]);

  const result = prep.prepareModelBatches({ taskDir, maxCandidates: 80, maxTextChars: 10 });

  assert.equal(result.modelBatchCount, 3);
  assert.deepEqual(result.modelBatchPaths.map(filePath => {
    const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return batch.candidates.map(item => item.candidate_id);
  }), [['one'], ['two'], ['three']]);
});

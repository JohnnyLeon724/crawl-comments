'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readReviewRows, validateCommentAiReview } = require('../src/normalize/validate-comment-ai-review.js');

const comments = [
  { row_key: 'a', text: '很好' },
  { row_key: 'b', text: '售后太差' },
  { row_key: 'c', text: '一般' }
];

function reviewRows() {
  return [
    { row_key: 'a', sentiment: '正面', negative_theme: '', reason: '认可', confidence: 'high' },
    { row_key: 'b', sentiment: '负面', negative_theme: '售后服务', reason: '售后抱怨', confidence: 'high' },
    { row_key: 'c', sentiment: '中性', negative_theme: '', reason: '陈述', confidence: 'medium' }
  ];
}

test('accepts complete one-to-one review results', () => {
  const result = validateCommentAiReview(comments, reviewRows());

  assert.equal(result.status, 'ok');
  assert.equal(result.summary.expected_count, 3);
  assert.equal(result.summary.review_count, 3);
  assert.deepEqual(result.errors, []);
});

test('rejects a missing review row key', () => {
  const result = validateCommentAiReview(comments, reviewRows().slice(0, 2));
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'missing_row_key' && error.row_key === 'c'), true);
});

test('rejects duplicate review row keys', () => {
  const rows = reviewRows();
  rows[2] = { ...rows[0] };
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'duplicate_row_key' && error.row_key === 'a'), true);
});

test('rejects a review row key outside the imported comments', () => {
  const rows = reviewRows();
  rows[2].row_key = 'unknown';
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'unexpected_row_key' && error.row_key === 'unknown'), true);
});

test('rejects an unknown sentiment', () => {
  const rows = reviewRows();
  rows[0].sentiment = '未知';
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'invalid_sentiment' && error.row_key === 'a'), true);
});

test('rejects a negative theme outside the controlled vocabulary', () => {
  const rows = reviewRows();
  rows[1].negative_theme = '凭空主题';
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'invalid_negative_theme' && error.row_key === 'b'), true);
});

test('rejects a theme on a non-negative review', () => {
  const rows = reviewRows();
  rows[0].negative_theme = '产品体验';
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'theme_requires_negative' && error.row_key === 'a'), true);
});

test('rejects a negative review without a theme', () => {
  const rows = reviewRows();
  rows[1].negative_theme = '';
  const result = validateCommentAiReview(comments, rows);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors.some(error => error.code === 'missing_negative_theme' && error.row_key === 'b'), true);
});

test('reads manifest review outputs written as cwd-relative paths', () => {
  const originalCwd = process.cwd();
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-cwd-'));
  const reviewDir = path.join(tempCwd, 'output', 'project', 'ai');
  const manifestPath = path.join(reviewDir, 'manifest.json');
  const reviewPath = path.join(reviewDir, 'review_001.json');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(reviewPath, JSON.stringify(reviewRows()));
  fs.writeFileSync(manifestPath, JSON.stringify({
    batches: [{ output_file: path.join('output', 'project', 'ai', 'review_001.json') }]
  }));

  try {
    process.chdir(tempCwd);
    assert.deepEqual(readReviewRows(manifestPath), reviewRows());
  } finally {
    process.chdir(originalCwd);
  }
});

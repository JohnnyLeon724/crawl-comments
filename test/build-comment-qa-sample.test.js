'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const qa = require('../script/build-comment-qa-sample.js');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('infers QA sample paths from a run directory', () => {
  const args = qa.parseArgs([
    '--run-dir', 'output/run_001',
    '--sample-size', '20'
  ]);

  assert.equal(args.comments, path.join('output/run_001', 'normalized-comments.jsonl'));
  assert.equal(args.aiReview, path.join('output/run_001', 'ai-review-input'));
  assert.equal(args.out, path.join('output/run_001', 'qa-sample.jsonl'));
  assert.equal(args.sampleSize, 20);
});

test('builds a deterministic QA sample prioritizing negative and low confidence rows', () => {
  const sample = qa.buildQaSample([
    { row_key: 'a', text: '很好', user_name: '用户A', row_type: 'level1' },
    { row_key: 'b', text: '售后差', user_name: '用户B', row_type: 'level1' },
    { row_key: 'c', text: '看不懂', user_name: '用户C', row_type: 'level2' },
    { row_key: 'd', text: '一般', user_name: '用户D', row_type: 'level1' }
  ], [
    { row_key: 'a', sentiment: '正面', negative_theme: '', reason: '认可', confidence: 'high' },
    { row_key: 'b', sentiment: '负面', negative_theme: '售后服务', reason: '抱怨售后', confidence: 'high' },
    { row_key: 'c', sentiment: '中性', negative_theme: '', reason: '疑问', confidence: 'low' }
  ], 3);

  assert.deepEqual(sample.map(row => row.row_key), ['b', 'c', 'd']);
  assert.equal(sample[0].ai_sentiment, '负面');
  assert.equal(sample[0].human_sentiment, '');
  assert.equal(sample[0].qa_note, '');
});

test('audits human QA labels into mismatch records', () => {
  const audit = qa.buildQaAudit([
    {
      row_key: 'a',
      ai_sentiment: '正面',
      ai_negative_theme: '',
      human_sentiment: '负面',
      human_negative_theme: '质量问题',
      qa_note: '明显在抱怨'
    },
    {
      row_key: 'b',
      ai_sentiment: '负面',
      ai_negative_theme: '售后服务',
      human_sentiment: '负面',
      human_negative_theme: '质量问题',
      qa_note: '不是售后问题'
    },
    {
      row_key: 'c',
      ai_sentiment: '中性',
      ai_negative_theme: '',
      human_sentiment: '中性',
      human_negative_theme: '',
      qa_note: ''
    }
  ]);

  assert.equal(audit.summary.reviewed_rows, 3);
  assert.equal(audit.summary.mismatch_count, 2);
  assert.deepEqual(audit.mismatches.map(row => row.issue_type), ['情感误判', '负面主题误判']);
});

test('writes QA sample JSONL and audit JSON files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-qa-'));
  const comments = path.join(dir, 'normalized-comments.jsonl');
  const aiReview = path.join(dir, 'ai-review-input');
  const sampleOut = path.join(dir, 'qa-sample.jsonl');
  const auditOut = path.join(dir, 'qa-mismatches.json');

  fs.mkdirSync(aiReview);
  fs.writeFileSync(comments, [
    JSON.stringify({ row_key: 'a', text: '很好', user_name: '用户A', row_type: 'level1' }),
    JSON.stringify({ row_key: 'b', text: '售后差', user_name: '用户B', row_type: 'level1' })
  ].join('\n'));
  writeJson(path.join(aiReview, 'review_001.json'), [
    { row_key: 'a', sentiment: '正面', negative_theme: '', reason: '认可', confidence: 'high' },
    { row_key: 'b', sentiment: '负面', negative_theme: '售后服务', reason: '抱怨售后', confidence: 'medium' }
  ]);

  const sampleResult = qa.writeQaSample({
    comments,
    aiReview,
    out: sampleOut,
    sampleSize: 2
  });
  const sampleRows = readJsonl(sampleOut);
  sampleRows[0].human_sentiment = '负面';
  sampleRows[0].human_negative_theme = '价格质疑';
  fs.writeFileSync(sampleOut, `${sampleRows.map(row => JSON.stringify(row)).join('\n')}\n`);

  const auditResult = qa.writeQaAudit({
    audit: sampleOut,
    out: auditOut
  });

  assert.equal(sampleResult.sampleCount, 2);
  assert.equal(fs.existsSync(sampleOut), true);
  assert.equal(auditResult.summary.mismatch_count, 1);
  assert.equal(readJson(auditOut).mismatches.length, 1);

  function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const normalizer = require('../script/normalize-comments.js');

test('parses explicit normalization arguments', () => {
  const args = normalizer.parseArgs([
    '--input', 'output/raw-comments.json',
    '--out', 'output/normalized-comments.jsonl',
    '--platform', 'douyin',
    '--source-url', 'https://www.douyin.com/video/123'
  ]);

  assert.equal(args.input, 'output/raw-comments.json');
  assert.equal(args.out, 'output/normalized-comments.jsonl');
  assert.equal(args.platform, 'douyin');
  assert.equal(args.sourceUrl, 'https://www.douyin.com/video/123');
});

test('infers raw and normalized paths from a run directory', () => {
  const args = normalizer.parseArgs([
    '--run-dir', 'output/run_001',
    '--platform', 'douyin'
  ]);

  assert.equal(args.input, path.join('output/run_001', 'raw-comments.json'));
  assert.equal(args.out, path.join('output/run_001', 'normalized-comments.jsonl'));
});

test('normalizes raw Douyin payload into schema-shaped rows', () => {
  const rows = normalizer.normalizePayload({
    source_url: 'https://www.douyin.com/video/123',
    results: [
      {
        row_type: 'level1',
        text: '用户A：画质不错 回复',
        captured_at: '2026-07-07T00:00:00.000Z'
      }
    ]
  }, {
    platform: 'douyin'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'douyin');
  assert.equal(rows[0].source_url, 'https://www.douyin.com/video/123');
  assert.equal(rows[0].text, '画质不错');
});

test('serializes normalized rows as JSONL', () => {
  const jsonl = normalizer.rowsToJsonl([
    { row_key: 'a', text: '第一条' },
    { row_key: 'b', text: '第二条' }
  ]);

  assert.equal(jsonl.split('\n').length, 3);
  assert.match(jsonl, /"第一条"/);
  assert.match(jsonl, /"第二条"/);
});

test('normalizes a raw comments file and writes JSONL output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-comments-'));
  const input = path.join(dir, 'raw-comments.json');
  const out = path.join(dir, 'normalized-comments.jsonl');
  fs.writeFileSync(input, JSON.stringify({
    source_url: 'https://www.douyin.com/video/123',
    results: [
      {
        row_type: 'level1',
        text: '用户A：画质不错',
        captured_at: '2026-07-07T00:00:00.000Z'
      }
    ]
  }));

  const summary = normalizer.normalizeFile({
    input,
    out,
    platform: 'douyin',
    sourceUrl: ''
  });

  assert.equal(summary.rowCount, 1);
  assert.equal(fs.existsSync(out), true);
  assert.match(fs.readFileSync(out, 'utf8'), /画质不错/);
});

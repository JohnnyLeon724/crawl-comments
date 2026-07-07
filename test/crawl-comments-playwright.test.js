'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const runner = require('../script/crawl-comments-playwright.js');

test('parses single-url CDP mode arguments', () => {
  const args = runner.parseArgs([
    '--url', 'https://www.douyin.com/video/123',
    '--cdp', 'http://127.0.0.1:9222',
    '--out-dir', 'output/run_001',
    '--timeout-ms', '900000'
  ]);

  assert.equal(args.url, 'https://www.douyin.com/video/123');
  assert.equal(args.cdp, 'http://127.0.0.1:9222');
  assert.equal(args.profile, '');
  assert.equal(args.outDir, 'output/run_001');
  assert.equal(args.timeoutMs, 900000);
});

test('defaults to a persistent profile when no CDP endpoint is provided', () => {
  const args = runner.parseArgs([
    '--url', 'https://www.douyin.com/video/123'
  ]);

  assert.equal(args.profile, '.pw-profile');
  assert.equal(args.headless, false);
});

test('rejects missing URL and conflicting browser modes', () => {
  assert.throws(() => runner.parseArgs([]), /--url/);
  assert.throws(() => runner.parseArgs([
    '--url', 'https://www.douyin.com/video/123',
    '--cdp', 'http://127.0.0.1:9222',
    '--profile', '.pw-profile'
  ]), /不能同时使用/);
});

test('builds stable output paths under the requested run directory', () => {
  const paths = runner.buildOutputPaths('output/run_001');

  assert.equal(paths.manifest, path.join('output/run_001', 'manifest.json'));
  assert.equal(paths.rawJson, path.join('output/run_001', 'raw-comments.json'));
  assert.equal(paths.rawCsv, path.join('output/run_001', 'raw-comments.csv'));
  assert.equal(paths.screenshot, path.join('output/run_001', 'final-page.png'));
});

test('builds a manifest with crawler state and output file paths', () => {
  const manifest = runner.buildManifest({
    runId: 'run_001',
    platform: 'douyin',
    sourceUrl: 'https://www.douyin.com/video/123',
    status: 'success',
    startedAt: '2026-07-07T00:00:00.000Z',
    finishedAt: '2026-07-07T00:01:00.000Z',
    payload: {
      state: {
        stopReason: 'idle',
        totalComments: 2,
        totalClicks: 5,
        round: 8,
        totalErrors: 0
      },
      results: [{ text: 'a' }, { text: 'b' }]
    },
    outputFiles: {
      rawJson: 'raw-comments.json',
      rawCsv: 'raw-comments.csv'
    },
    errors: []
  });

  assert.equal(manifest.run_id, 'run_001');
  assert.equal(manifest.platform, 'douyin');
  assert.equal(manifest.status, 'success');
  assert.equal(manifest.stop_reason, 'idle');
  assert.equal(manifest.raw_comment_count, 2);
  assert.equal(manifest.total_clicks, 5);
  assert.deepEqual(manifest.output_files, {
    rawJson: 'raw-comments.json',
    rawCsv: 'raw-comments.csv'
  });
});

test('serializes payload results as CSV with BOM', () => {
  const csv = runner.payloadToCsv({
    results: [
      {
        row_type: 'level1',
        text: '第一条',
        dom_path: 'DIV:nth-of-type(1)',
        captured_at: '2026-07-07T00:00:00.000Z'
      }
    ]
  });

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /第一条/);
});

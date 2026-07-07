'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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

test('loads Playwright from bundled runtime when local dependency is missing', () => {
  const playwright = runner.loadPlaywright();

  assert.equal(Boolean(playwright.chromium), true);
});

test('uses installed Chrome when Playwright bundled browser is unavailable', () => {
  const executablePath = runner.findChromeExecutable();
  const options = runner.buildLaunchOptions({
    headless: false,
    viewport: { width: 1440, height: 1000 }
  }, {
    executablePath: () => '/missing/playwright/chromium'
  });

  assert.match(executablePath, /Google Chrome|Chromium|Microsoft Edge/);
  assert.equal(options.executablePath, executablePath);
});

test('rejects missing URL and conflicting browser modes', () => {
  assert.throws(() => runner.parseArgs([]), /--url/);
  assert.throws(() => runner.parseArgs([
    '--url', 'https://www.douyin.com/video/123',
    '--cdp', 'http://127.0.0.1:9222',
    '--profile', '.pw-profile'
  ]), /不能同时使用/);
});

test('parses batch input, resume, delay, and retries arguments', () => {
  const args = runner.parseArgs([
    '--input', 'urls.txt',
    '--out-dir', 'output/batch_001',
    '--resume',
    '--delay-ms', '2000',
    '--retries', '2'
  ]);

  assert.equal(args.input, 'urls.txt');
  assert.equal(args.url, '');
  assert.equal(args.resume, true);
  assert.equal(args.delayMs, 2000);
  assert.equal(args.retries, 2);
});

test('rejects conflicting single and batch URL modes', () => {
  assert.throws(() => runner.parseArgs([
    '--url', 'https://www.douyin.com/video/123',
    '--input', 'urls.txt'
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

test('reads URL lists while ignoring blank lines and comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-urls-'));
  const file = path.join(dir, 'urls.txt');
  fs.writeFileSync(file, [
    '# comment',
    '',
    'https://www.douyin.com/video/1',
    '  https://www.douyin.com/video/2  '
  ].join('\n'));

  assert.deepEqual(runner.readInputUrls(file), [
    'https://www.douyin.com/video/1',
    'https://www.douyin.com/video/2'
  ]);
});

test('builds deterministic per-url output directories for batch runs', () => {
  assert.equal(
    runner.buildBatchItemOutDir('output/run', 'https://www.douyin.com/video/123', 0),
    path.join('output/run', '001-douyin-123')
  );

  assert.match(
    runner.buildBatchItemOutDir('output/run', 'https://example.com/post/abc', 11),
    /012-unknown-[a-f0-9]{10}$/
  );
});

test('skips completed batch items when resume is enabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-resume-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ status: 'success' }));

  assert.equal(runner.shouldSkipForResume(dir, true), true);
  assert.equal(runner.shouldSkipForResume(dir, false), false);
});

test('retries failed URL crawls and records attempts', async () => {
  let calls = 0;
  const result = await runner.crawlWithRetries(
    { url: 'https://www.douyin.com/video/1', retries: 2 },
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(`fail ${calls}`);
      }
      return { status: 'success', outputFiles: {}, payload: { results: [] }, errors: [] };
    }
  );

  assert.equal(calls, 3);
  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 3);
});

test('runs batch URLs sequentially and writes a batch manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-batch-'));
  const input = path.join(dir, 'urls.txt');
  fs.writeFileSync(input, [
    'https://www.douyin.com/video/1',
    'https://www.douyin.com/video/2'
  ].join('\n'));

  const visited = [];
  const result = await runner.crawlBatch({
    input,
    outDir: dir,
    retries: 0,
    resume: false,
    delayMs: 0
  }, {
    crawlSingleUrl: async itemArgs => {
      visited.push(itemArgs.url);
      return {
        runId: `run-${visited.length}`,
        status: 'success',
        outDir: itemArgs.outDir,
        outputFiles: {},
        payload: { results: [] },
        errors: []
      };
    },
    sleep: async () => {}
  });

  assert.deepEqual(visited, [
    'https://www.douyin.com/video/1',
    'https://www.douyin.com/video/2'
  ]);
  assert.equal(result.status, 'success');
  assert.equal(result.items.length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'batch-manifest.json')), true);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../script/comment-crawler-config.js');
const logs = require('../script/comment-crawler-log.js');
const xiaohongshu = require('../adapters/xiaohongshu.js');

test('loads default config and deep-merges JSON config with overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-config-'));
  const configPath = path.join(dir, 'comment-crawler.config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    crawler: {
      delayMs: 1500,
      retries: 2
    },
    ai: {
      batchSize: 25
    },
    output: {
      baseDir: 'custom-output'
    }
  }, null, 2));

  const loaded = config.loadConfig({
    configPath,
    overrides: {
      crawler: {
        headless: true
      }
    }
  });

  assert.equal(loaded.crawler.profile, '.pw-profile');
  assert.equal(loaded.crawler.delayMs, 1500);
  assert.equal(loaded.crawler.retries, 2);
  assert.equal(loaded.crawler.headless, true);
  assert.equal(loaded.ai.batchSize, 25);
  assert.equal(loaded.output.baseDir, 'custom-output');
});

test('example config file is loadable', () => {
  const loaded = config.loadConfig({
    configPath: path.join(process.cwd(), 'config/comment-crawler.config.example.json')
  });

  assert.equal(loaded.crawler.profile, '.pw-profile');
  assert.equal(loaded.ai.batchSize > 0, true);
  assert.equal(loaded.output.baseDir, 'output');
});

test('writes JSONL run log events with stable metadata and serialized errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-log-'));
  const logFile = path.join(dir, 'run-events.jsonl');
  const logger = logs.createRunLogger(logFile, {
    runId: 'run_001',
    platform: 'xiaohongshu'
  });

  logger.info('crawl.start', '开始采集', { url: 'https://example.com' });
  logger.error('crawl.failed', '采集失败', new Error('blocked'));

  const rows = fs.readFileSync(logFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].run_id, 'run_001');
  assert.equal(rows[0].platform, 'xiaohongshu');
  assert.equal(rows[0].level, 'info');
  assert.equal(rows[0].event, 'crawl.start');
  assert.deepEqual(rows[0].data, { url: 'https://example.com' });
  assert.equal(rows[1].level, 'error');
  assert.equal(rows[1].data.message, 'blocked');
});

test('fixture payloads stay usable by platform adapters', () => {
  const fixturePath = path.join(process.cwd(), 'test/fixtures/comment-crawler/xiaohongshu-comments-payload.json');
  const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const rows = xiaohongshu.normalizeXiaohongshuPayload(payload);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].platform, 'xiaohongshu');
  assert.equal(rows[0].like_count, 21000);
  assert.equal(rows[1].row_type, 'level2');
  assert.equal(rows[1].reply_to_user_name, 'Alice');
});

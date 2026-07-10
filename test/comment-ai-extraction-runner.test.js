'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runner = require('../src/normalize/run-comment-ai-extraction.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function batch(batchKind, overrides = {}) {
  return Object.assign({
    schema_version: 'comment-dom-batch-v1',
    batch_id: `${batchKind}_001`,
    task_id: 'task_0001',
    platform: 'weibo',
    batch_kind: batchKind,
    source_url: 'https://weibo.com/detail/123',
    candidates: [{
      candidate_id: 'weibo:comment-1',
      source_comment_id: 'comment-1',
      inner_text: '售后没人处理',
      source_author_uid_href: '/u/100',
      source_comment_timestamp: '7月10日',
      source_reply_context: '',
      source_root_context: '电视坏了',
      source_composite_fingerprint: 'sha256:fixture'
    }]
  }, overrides);
}

test('dry-run invokes Codex only for model batches with a strict schema clone', () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-ai-extraction-runner-'));
  writeJson(path.join(taskDir, 'batches', 'capture_001', 'comment-dom-batch.json'), batch('capture'));
  writeJson(path.join(taskDir, 'batches', 'model_001', 'comment-dom-batch.json'), batch('model'));

  const result = runner.runExtractionBatches({
    taskDir,
    dryRun: true,
    codexBin: '/tmp/codex',
    cwd: '/tmp/project'
  });

  const strictSchemaPath = path.join(taskDir, 'model-output-schema.json');
  assert.equal(result.batchCount, 1);
  assert.equal(fs.existsSync(strictSchemaPath), true);
  assert.equal(result.results[0].command.args.includes(strictSchemaPath), true);
  assert.equal(result.results[0].command.args.includes(path.join(taskDir, 'batches', 'model_001', 'ai-comment-extraction.json')), true);
  assert.match(result.results[0].prompt, /"platform": "weibo"/);
  assert.match(result.results[0].prompt, /source_comment_id、父评论 ID、根评论 ID、作者 UID href、时间、回复\/根上下文和复合指纹均由 DOM 证据回填，禁止模型推测、输出或补全/);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const schema = require('../schemas/comment-ai-review.schema.json');
const prep = require('../script/prepare-comment-ai-review.js');
const runner = require('../script/run-comment-ai-review.js');

test('AI review schema defines structured sentiment output', () => {
  assert.equal(schema.type, 'array');
  assert.equal(schema.items.type, 'object');

  const required = new Set(schema.items.required);
  for (const field of ['row_key', 'sentiment', 'negative_theme', 'reason', 'confidence']) {
    assert.equal(required.has(field), true, `${field} should be required`);
  }

  assert.deepEqual(schema.items.properties.sentiment.enum, ['负面', '正面', '中性']);
});

test('reads normalized comments from JSONL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-jsonl-'));
  const file = path.join(dir, 'normalized-comments.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ row_key: 'a', text: '第一条' }),
    '',
    JSON.stringify({ row_key: 'b', text: '第二条' })
  ].join('\n'));

  assert.deepEqual(prep.readJsonl(file).map(row => row.row_key), ['a', 'b']);
});

test('builds bounded AI review items with reply context', () => {
  const item = prep.buildReviewItem({
    row_key: 'r1',
    row_type: 'level2',
    user_name: '用户B',
    text: '售后没人处理',
    root_text: '电视坏了',
    reply_to_user_name: '用户A'
  });

  assert.deepEqual(item, {
    row_key: 'r1',
    row_type: 'level2',
    user_name: '用户B',
    text: '售后没人处理',
    root_text: '电视坏了',
    reply_to_user_name: '用户A'
  });
});

test('chunks review items by requested batch size', () => {
  const chunks = prep.chunkRows([{ row_key: '1' }, { row_key: '2' }, { row_key: '3' }], 2);

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(chunk => chunk.length), [2, 1]);
});

test('splits review items by both item and character ceilings', () => {
  const items = [
    { row_key: 'a', text: '12345' },
    { row_key: 'b', text: '67890' },
    { row_key: 'c', text: 'abcde' }
  ];

  assert.deepEqual(
    prep.splitReviewItems(items, 2, 10).map(chunk => chunk.map(row => row.row_key)),
    [['a', 'b'], ['c']]
  );
});

test('writes AI review prompt batches and manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-prep-'));
  const input = path.join(dir, 'normalized-comments.jsonl');
  const outDir = path.join(dir, 'ai-review-input');
  fs.writeFileSync(input, [
    JSON.stringify({ row_key: 'a', row_type: 'level1', user_name: '用户A', text: '很好', root_text: '', reply_to_user_name: '' }),
    JSON.stringify({ row_key: 'b', row_type: 'level1', user_name: '用户B', text: '售后差', root_text: '', reply_to_user_name: '' })
  ].join('\n'));

  const result = prep.prepareReviewBatches({
    input,
    outDir,
    batchSize: 1
  });

  assert.equal(result.batchCount, 2);
  assert.equal(fs.existsSync(path.join(outDir, 'prompt_001.txt')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'rows_001.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'manifest.json')), true);
  assert.match(fs.readFileSync(path.join(outDir, 'prompt_001.txt'), 'utf8'), /JSON schema/);
});

test('records the character ceiling and keeps reply context in review prompts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-context-'));
  const input = path.join(dir, 'normalized-comments.jsonl');
  const outDir = path.join(dir, 'ai-review-input');
  fs.writeFileSync(input, JSON.stringify({
    row_key: 'reply',
    row_type: 'level2',
    user_name: '用户B',
    text: '确实没修好',
    root_text: '电视坏了',
    reply_to_user_name: '用户A'
  }));

  prep.prepareReviewBatches({ input, outDir, batchSize: 80, maxChars: 24000 });

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const prompt = fs.readFileSync(path.join(outDir, 'prompt_001.txt'), 'utf8');
  assert.equal(manifest.max_chars, 24000);
  assert.match(prompt, /历史导入没有微博正文/);
  assert.match(prompt, /root_text/);
  assert.match(prompt, /reply_to_user_name/);
});

test('builds Codex CLI command arguments for a review batch', () => {
  const command = runner.buildCodexExecCommand({
    codexBin: '/Applications/Codex.app/Contents/Resources/codex',
    cwd: '/tmp/project',
    schemaPath: '/tmp/project/schemas/comment-ai-review.schema.json',
    outputFile: '/tmp/project/output/review_001.json'
  });

  assert.equal(command.command, '/Applications/Codex.app/Contents/Resources/codex');
  assert.deepEqual(command.args, [
    'exec',
    '--skip-git-repo-check',
    '--cd',
    '/tmp/project',
    '--sandbox',
    'read-only',
    '--output-schema',
    '/tmp/project/schemas/comment-ai-review.schema.json',
    '-o',
    '/tmp/project/output/review_001.json',
    '-'
  ]);
});

test('uses a generated strict schema for model review commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-model-schema-'));
  const inputDir = path.join(dir, 'input');
  fs.mkdirSync(inputDir);
  const promptFile = path.join(inputDir, 'prompt_001.txt');
  fs.writeFileSync(promptFile, 'review these comments');
  fs.writeFileSync(path.join(inputDir, 'manifest.json'), JSON.stringify({
    batches: [{ prompt_file: promptFile, output_file: path.join(inputDir, 'review_001.json') }]
  }));

  const result = runner.runReviewBatches({
    inputDir,
    codexBin: '/tmp/codex',
    cwd: dir,
    schemaPath: path.join(__dirname, '..', 'schemas', 'comment-ai-review.schema.json'),
    dryRun: true
  });

  const strictSchemaPath = path.join(inputDir, 'model-output-schema.json');
  assert.equal(fs.existsSync(strictSchemaPath), true);
  assert.equal(result.modelSchemaPath, strictSchemaPath);
  assert.equal(result.results[0].command.args.includes(strictSchemaPath), true);
});

test('resume mode skips only a complete review output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-resume-'));
  const rowsFile = path.join(dir, 'rows_001.json');
  const promptFile = path.join(dir, 'prompt_001.txt');
  const outputFile = path.join(dir, 'review_001.json');
  const batch = { rows_file: rowsFile, prompt_file: promptFile, output_file: outputFile };

  fs.writeFileSync(rowsFile, JSON.stringify([{ row_key: 'a' }]));
  fs.writeFileSync(promptFile, 'review');
  fs.writeFileSync(outputFile, JSON.stringify([{ row_key: 'a' }]));
  assert.equal(runner.isCompleteReviewOutput(batch), true);

  fs.writeFileSync(outputFile, JSON.stringify([{ row_key: 'a' }, { row_key: 'a' }]));
  assert.equal(runner.isCompleteReviewOutput(batch), false);

  fs.writeFileSync(outputFile, JSON.stringify([{ row_key: 'b' }]));
  assert.equal(runner.isCompleteReviewOutput(batch), false);
});

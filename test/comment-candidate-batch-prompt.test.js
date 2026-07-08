'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const promptPath = path.join(__dirname, '..', 'prompts', 'comment-candidate-batch-extraction.md');

test('comment candidate batch prompt documents candidate based extraction', () => {
  assert.equal(fs.existsSync(promptPath), true);

  const prompt = fs.readFileSync(promptPath, 'utf8');
  for (const requiredText of [
    'comment-dom-batch-v1',
    'ai-comment-extraction-v1',
    'candidate_id',
    'source_chunk_id',
    'source_batch_id',
    'candidate_hash',
    'rows',
    'rejected'
  ]) {
    assert.match(prompt, new RegExp(requiredText));
  }
});

test('comment candidate batch prompt keeps AI focused on semantic field splitting', () => {
  const prompt = fs.readFileSync(promptPath, 'utf8');
  for (const requiredText of [
    '不要做滚动',
    '不要推测',
    '只放评论正文',
    'UI 文案',
    '页脚',
    '播放器',
    '登录弹窗'
  ]) {
    assert.match(prompt, new RegExp(requiredText));
  }
});

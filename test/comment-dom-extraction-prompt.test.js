'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const promptPath = path.join(__dirname, '..', 'prompts', 'comment-dom-extraction.md');

test('comment DOM extraction prompt documents the AI output contract', () => {
  assert.equal(fs.existsSync(promptPath), true);

  const prompt = fs.readFileSync(promptPath, 'utf8');
  for (const requiredText of [
    'ai-comment-extraction-v1',
    'source_chunk_id',
    'rows',
    'rejected',
    'user_name',
    'ip_location',
    'like_count'
  ]) {
    assert.match(prompt, new RegExp(requiredText));
  }
});

test('comment DOM extraction prompt tells AI to reject page noise', () => {
  const prompt = fs.readFileSync(promptPath, 'utf8');
  for (const noise of [
    '页脚',
    '播放器',
    '笔记正文',
    '推荐区',
    '不要把 UI 文案拼进正文'
  ]) {
    assert.match(prompt, new RegExp(noise));
  }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const docPath = path.join(__dirname, '..', 'docs', 'comment-crawler-mcp-usage.md');

test('usage documentation describes the Chrome default workflow', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const requiredText of [
    'Chrome default comment capture workflow',
    'chrome:control-chrome',
    'default browser execution surface',
    'fresh tab',
    'tab.playwright',
    'comment-dom-batch-v1',
    'comment-dom-batch.json',
    'capture-state.json',
    'ai-comment-extraction.json',
    'normalized-comments.jsonl',
    'comment-candidate-batch-extraction.md',
    '--batch',
    'merge_task_batches.py'
  ]) {
    assert.match(doc, new RegExp(requiredText));
  }
});

test('usage documentation keeps MCP as fallback and blocks verification bypasses', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const requiredText of [
    'MCP/CDP fallback',
    'expand_and_capture_comment_batches',
    'capture_comment_candidate_batch',
    'capture_comment_candidate_batches_until_idle',
    'closePageAfter',
    'login',
    'CAPTCHA',
    'verification',
    'user action',
    'Do not bypass'
  ]) {
    assert.match(doc, new RegExp(requiredText));
  }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const docPath = path.join(__dirname, '..', 'docs', 'comment-crawler-mcp-usage.md');

test('MCP usage documentation describes the batch candidate workflow', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const requiredText of [
    'capture_comment_candidate_batch',
    'capture_comment_candidate_batches_until_idle',
    'comment-dom-batch.json',
    'capture-state.json',
    'comment-candidate-batch-extraction.md',
    '--batch',
    'merge_task_batches.py',
    'closePageAfter'
  ]) {
    assert.match(doc, new RegExp(requiredText));
  }
});

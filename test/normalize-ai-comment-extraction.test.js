'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const normalizer = require('../script/normalize-ai-comment-extraction.js');
const schema = require('../schemas/comment-row.schema.json');

function assertMatchesCommentRowSchema(row) {
  for (const field of schema.required) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, field), `${field} should exist`);
  }
  assert.equal(schema.properties.platform.enum.includes(row.platform), true);
  assert.equal(schema.properties.row_type.enum.includes(row.row_type), true);
  assert.equal(typeof row.raw, 'object');
}

test('infers AI extraction paths from a run directory', () => {
  const args = normalizer.parseArgs([
    '--run-dir',
    'output/run_001',
    '--platform',
    'xiaohongshu'
  ]);

  assert.equal(args.input, path.join('output/run_001', 'ai-comment-extraction.json'));
  assert.equal(args.snapshot, path.join('output/run_001', 'comment-dom-snapshot.json'));
  assert.equal(args.out, path.join('output/run_001', 'normalized-comments.jsonl'));
  assert.equal(args.platform, 'xiaohongshu');
});

test('normalizes AI extracted rows into existing comment row shape', () => {
  const extraction = {
    schema_version: 'ai-comment-extraction-v1',
    source_url: 'https://www.xiaohongshu.com/explore/69ce1e1d000000001a036d9b',
    platform: 'xiaohongshu',
    rows: [
      {
        source_chunk_id: 'chunk_0001',
        row_type: 'level1',
        user_name: '托马斯',
        text: '这是我用到现在最好的轮胎',
        created_at: '04-04',
        ip_location: '上海',
        like_count: 24,
        reply_to_user_name: '',
        root_text: '',
        is_pinned: true,
        is_author: false,
        confidence: 'high',
        evidence: '托马斯这是我用到现在最好的轮胎置顶评论04-04上海24'
      }
    ],
    rejected: [
      {
        source_chunk_id: 'chunk_footer',
        reason: 'footer_legal_text'
      }
    ]
  };
  const snapshot = {
    schema_version: 'comment-dom-snapshot-v1',
    chunks: [
      {
        chunk_id: 'chunk_0001',
        inner_text: '托马斯这是我用到现在最好的轮胎置顶评论04-04上海24'
      }
    ]
  };

  const rows = normalizer.normalizeAiExtraction(extraction, {
    snapshot,
    platform: 'xiaohongshu'
  });

  assert.equal(rows.length, 1);
  assertMatchesCommentRowSchema(rows[0]);
  assert.equal(rows[0].platform, 'xiaohongshu');
  assert.equal(rows[0].post_id, '69ce1e1d000000001a036d9b');
  assert.equal(rows[0].user_name, '托马斯');
  assert.equal(rows[0].text, '这是我用到现在最好的轮胎');
  assert.equal(rows[0].created_at, '04-04');
  assert.equal(rows[0].like_count, 24);
  assert.equal(rows[0].root_text, '这是我用到现在最好的轮胎');
  assert.equal(rows[0].raw.ai_row.source_chunk_id, 'chunk_0001');
  assert.equal(rows[0].raw.ai_row.ip_location, '上海');
  assert.equal(rows[0].raw.source_chunk.inner_text, snapshot.chunks[0].inner_text);
});

test('normalizes an AI extraction file and writes JSONL output', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-ai-normalize-'));
  const extractionPath = path.join(runDir, 'ai-comment-extraction.json');
  const snapshotPath = path.join(runDir, 'comment-dom-snapshot.json');
  const outPath = path.join(runDir, 'normalized-comments.jsonl');

  fs.writeFileSync(extractionPath, `${JSON.stringify({
    schema_version: 'ai-comment-extraction-v1',
    source_url: 'https://www.douyin.com/video/7624758376937969290',
    platform: 'douyin',
    rows: [
      {
        source_chunk_id: 'chunk_0001',
        row_type: 'level1',
        user_name: 'Klaus｜胡萝卜',
        text: '哥，极氪001换胎，255 55 19选竞驰5E还是浩悦5E啊？',
        created_at: '3月前',
        ip_location: '江苏',
        like_count: 2,
        reply_to_user_name: '',
        root_text: '',
        is_pinned: false,
        is_author: false,
        confidence: 'high',
        evidence: 'Klaus｜胡萝卜...哥，极氪001换胎，255 55 19选竞驰5E还是浩悦5E啊？3月前·江苏2分享'
      }
    ],
    rejected: []
  }, null, 2)}\n`);
  fs.writeFileSync(snapshotPath, `${JSON.stringify({
    schema_version: 'comment-dom-snapshot-v1',
    chunks: [
      {
        chunk_id: 'chunk_0001',
        inner_text: 'Klaus｜胡萝卜...哥，极氪001换胎，255 55 19选竞驰5E还是浩悦5E啊？3月前·江苏2分享'
      }
    ]
  }, null, 2)}\n`);

  const summary = normalizer.normalizeFile({
    input: extractionPath,
    snapshot: snapshotPath,
    out: outPath,
    platform: 'douyin'
  });

  assert.equal(summary.status, 'success');
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.rejectedCount, 0);
  assert.equal(fs.existsSync(outPath), true);

  const rows = fs.readFileSync(outPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  assert.equal(rows[0].post_id, '7624758376937969290');
  assert.equal(rows[0].raw.snapshot_file, snapshotPath);
});

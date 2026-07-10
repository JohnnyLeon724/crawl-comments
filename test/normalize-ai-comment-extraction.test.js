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
  assert.equal(args.task, path.join('output/run_001', 'task.json'));
  assert.equal(args.out, path.join('output/run_001', 'normalized-comments.jsonl'));
  assert.equal(args.platform, 'xiaohongshu');
});

test('parses explicit task context path', () => {
  const args = normalizer.parseArgs([
    '--input',
    'ai-comment-extraction.json',
    '--snapshot',
    'comment-dom-snapshot.json',
    '--task',
    'task.json',
    '--out',
    'normalized-comments.jsonl'
  ]);

  assert.equal(args.task, 'task.json');
});

test('parses explicit batch snapshot path', () => {
  const args = normalizer.parseArgs([
    '--input',
    'ai-comment-extraction.json',
    '--batch',
    'comment-dom-batch.json',
    '--out',
    'normalized-comments.jsonl'
  ]);

  assert.equal(args.batch, 'comment-dom-batch.json');
  assert.equal(args.snapshot, '');
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
    platform: 'xiaohongshu',
    task: {
      task_id: 'task_0007',
      phase: 'KOL link-0630',
      source_excel_row: 8,
      source_index: '7',
      creator_name: '不劳累',
      published_at_text: '5.23',
      engagement_count: 143,
      expected_comment_count: 49
    }
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
  assert.equal(rows[0].task_id, 'task_0007');
  assert.equal(rows[0].phase, 'KOL link-0630');
  assert.equal(rows[0].source_excel_row, 8);
  assert.equal(rows[0].creator_name, '不劳累');
  assert.equal(rows[0].raw.task.expected_comment_count, 49);
});

test('normalizes AI rows against comment DOM batch candidates', () => {
  const extraction = {
    schema_version: 'ai-comment-extraction-v1',
    source_url: 'https://www.douyin.com/video/7624758376937969290',
    platform: 'douyin',
    rows: [
      {
        source_chunk_id: 'candidate_000001',
        row_type: 'level1',
        user_name: 'Klaus｜胡萝卜',
        text: '255 55 19选竞驰5E还是浩悦5E啊？',
        created_at: '3月前',
        ip_location: '江苏',
        like_count: 2,
        reply_to_user_name: '',
        root_text: '',
        is_pinned: false,
        is_author: false,
        confidence: 'high',
        evidence: 'Klaus｜胡萝卜...255 55 19选竞驰5E还是浩悦5E啊？3月前·江苏2分享'
      }
    ],
    rejected: []
  };
  const batch = {
    schema_version: 'comment-dom-batch-v1',
    batch_id: 'batch_0001',
    candidates: [
      {
        candidate_id: 'candidate_000001',
        candidate_hash: 'hash-1',
        inner_text: 'Klaus｜胡萝卜...255 55 19选竞驰5E还是浩悦5E啊？3月前·江苏2分享'
      }
    ]
  };

  const firstBatchRows = normalizer.normalizeAiExtraction(extraction, {
    snapshot: batch,
    platform: 'douyin'
  });
  const secondBatchRows = normalizer.normalizeAiExtraction(extraction, {
    snapshot: Object.assign({}, batch, { batch_id: 'batch_0002' }),
    platform: 'douyin'
  });

  assert.equal(firstBatchRows.length, 1);
  assert.equal(firstBatchRows[0].raw.source_batch_id, 'batch_0001');
  assert.equal(firstBatchRows[0].raw.source_candidate_id, 'candidate_000001');
  assert.equal(firstBatchRows[0].raw.source_chunk.inner_text, batch.candidates[0].inner_text);
  assert.notEqual(firstBatchRows[0].row_key, secondBatchRows[0].row_key);
});

test('uses DOM-ID candidate evidence for Weibo post and comment identities', () => {
  const extraction = {
    platform: 'weibo',
    source_url: 'https://weibo.com/1812511057/Pa1Bc2D3e',
    rows: [{
      source_chunk_id: 'weibo:c-100',
      row_type: 'level1',
      user_name: '用户A',
      text: '评论',
      created_at: '',
      ip_location: '',
      like_count: 0,
      reply_to_user_name: '',
      root_text: '',
      is_pinned: false,
      is_author: false,
      confidence: 'high',
      evidence: ''
    }]
  };
  const snapshot = {
    schema_version: 'comment-dom-batch-v1',
    batch_id: 'model_001',
    candidates: [{
      candidate_id: 'weibo:c-100',
      identity_mode: 'dom_id',
      source_comment_id: 'c-100',
      source_parent_comment_id: '',
      source_root_comment_id: 'c-100',
      source_capture_batch_ids: ['capture_hot_001', 'capture_time_001']
    }]
  };

  const rows = normalizer.normalizeAiExtraction(extraction, { snapshot });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].comment_id, 'c-100');
  assert.equal(rows[0].parent_comment_id, '');
  assert.equal(rows[0].root_comment_id, 'c-100');
  assert.equal(rows[0].post_id, '1812511057/Pa1Bc2D3e');
  assert.equal(
    rows[0].row_key,
    normalizer.buildRowKey(['weibo', extraction.source_url, 'c-100'])
  );
});

test('keeps composite candidate identities out of canonical IDs', () => {
  const extraction = {
    platform: 'weibo',
    source_url: 'https://www.weibo.com/detail/Pa1Bc2D3e',
    rows: [{
      source_chunk_id: 'weibo:fp:example',
      row_type: 'level2',
      user_name: '用户B',
      text: '回复内容',
      created_at: '',
      ip_location: '',
      like_count: 0,
      reply_to_user_name: '用户A',
      root_text: '原评论',
      is_pinned: false,
      is_author: false,
      confidence: 'high',
      evidence: ''
    }]
  };
  const candidate = {
    candidate_id: 'weibo:fp:example',
    identity_mode: 'composite_fingerprint',
    source_author_uid_href: '/u/200',
    source_comment_text: '回复内容',
    source_comment_timestamp: '7月10日',
    source_reply_context: '回复 用户A',
    source_root_context: '原评论',
    source_composite_fingerprint: 'sha256:example',
    source_capture_batch_ids: ['capture_hot_001', 'capture_time_001']
  };

  const rows = normalizer.normalizeAiExtraction(extraction, {
    snapshot: {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'model_001',
      candidates: [candidate]
    }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].comment_id, '');
  assert.equal(rows[0].parent_comment_id, '');
  assert.equal(rows[0].root_comment_id, '');
  assert.equal(
    rows[0].row_key,
    normalizer.buildRowKey(['weibo', extraction.source_url, 'sha256:example'])
  );
  assert.equal(rows[0].raw.source_chunk.identity_mode, 'composite_fingerprint');
  assert.equal(rows[0].raw.source_chunk.source_author_uid_href, '/u/200');
  assert.equal(rows[0].raw.source_chunk.source_composite_fingerprint, 'sha256:example');
});

test('rejects Weibo AI rows without matching or complete candidate identity evidence', () => {
  const extraction = {
    platform: 'weibo',
    source_url: 'https://weibo.com/1812511057/Pa1Bc2D3e',
    rows: [{
      source_chunk_id: 'weibo:missing',
      row_type: 'level1',
      user_name: '用户C',
      text: '不能写入',
      created_at: '',
      like_count: 0
    }, {
      source_chunk_id: 'weibo:incomplete-fingerprint',
      row_type: 'level1',
      user_name: '用户D',
      text: '证据不完整',
      created_at: '',
      like_count: 0
    }]
  };
  const snapshot = {
    schema_version: 'comment-dom-batch-v1',
    batch_id: 'model_001',
    candidates: [{
      candidate_id: 'weibo:incomplete-fingerprint',
      identity_mode: 'composite_fingerprint',
      source_author_uid_href: '/u/300',
      source_comment_text: '证据不完整',
      source_comment_timestamp: '7月10日',
      source_reply_context: '',
      source_root_context: '',
      source_composite_fingerprint: 'sha256:incomplete'
    }]
  };

  assert.deepEqual(normalizer.normalizeAiExtraction(extraction, { snapshot }), []);
});

test('normalizes an AI extraction file and writes JSONL output', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-ai-normalize-'));
  const extractionPath = path.join(runDir, 'ai-comment-extraction.json');
  const snapshotPath = path.join(runDir, 'comment-dom-snapshot.json');
  const taskPath = path.join(runDir, 'task.json');
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
  fs.writeFileSync(taskPath, `${JSON.stringify({
    task_id: 'task_0001',
    phase: 'KOL link-0630',
    source_excel_row: 2,
    source_index: '1',
    creator_name: 'DJ初仔大朋友',
    published_at_text: '6.15',
    engagement_count: 134000,
    expected_comment_count: 2922
  }, null, 2)}\n`);

  const summary = normalizer.normalizeFile({
    input: extractionPath,
    snapshot: snapshotPath,
    task: taskPath,
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
  assert.equal(rows[0].task_id, 'task_0001');
  assert.equal(rows[0].source_excel_row, 2);
  assert.equal(rows[0].raw.snapshot_file, snapshotPath);
  assert.equal(rows[0].raw.task.creator_name, 'DJ初仔大朋友');
});

test('normalizes an AI extraction file with a batch input', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-ai-batch-normalize-'));
  const extractionPath = path.join(runDir, 'ai-comment-extraction.json');
  const batchPath = path.join(runDir, 'comment-dom-batch.json');
  const outPath = path.join(runDir, 'normalized-comments.jsonl');

  fs.writeFileSync(extractionPath, `${JSON.stringify({
    schema_version: 'ai-comment-extraction-v1',
    source_url: 'https://www.xiaohongshu.com/explore/69ce1e1d000000001a036d9b',
    platform: 'xiaohongshu',
    rows: [
      {
        source_chunk_id: 'candidate_000001',
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
    rejected: []
  }, null, 2)}\n`);
  fs.writeFileSync(batchPath, `${JSON.stringify({
    schema_version: 'comment-dom-batch-v1',
    batch_id: 'batch_0007',
    candidates: [
      {
        candidate_id: 'candidate_000001',
        inner_text: '托马斯这是我用到现在最好的轮胎置顶评论04-04上海24'
      }
    ]
  }, null, 2)}\n`);

  const summary = normalizer.normalizeFile({
    input: extractionPath,
    batch: batchPath,
    out: outPath
  });

  assert.equal(summary.status, 'success');
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.batch, batchPath);

  const rows = fs.readFileSync(outPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  assert.equal(rows[0].raw.source_batch_id, 'batch_0007');
  assert.equal(rows[0].raw.source_candidate_id, 'candidate_000001');
  assert.equal(rows[0].raw.snapshot_file, batchPath);
});

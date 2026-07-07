'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../script/build-comment-excel-report.js');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('infers report paths from a run directory', () => {
  const args = report.parseArgs([
    '--run-dir', 'output/run_001'
  ]);

  assert.equal(args.comments, path.join('output/run_001', 'normalized-comments.jsonl'));
  assert.equal(args.aiReview, path.join('output/run_001', 'ai-review-input'));
  assert.equal(args.out, path.join('output/run_001', 'comment-report.xlsx'));
});

test('merges normalized comments with AI review rows into report sheets', () => {
  const model = report.buildReportModel([
    {
      row_key: 'a',
      platform: 'douyin',
      source_url: 'https://example.com/a',
      row_type: 'level1',
      user_name: '用户A',
      text: '画质很好',
      like_count: 3
    },
    {
      row_key: 'b',
      platform: 'douyin',
      source_url: 'https://example.com/a',
      row_type: 'level1',
      user_name: '用户B',
      text: '售后没人处理',
      like_count: 1
    },
    {
      row_key: 'c',
      platform: 'douyin',
      source_url: 'https://example.com/a',
      row_type: 'level2',
      user_name: '用户C',
      text: '还没看懂',
      like_count: 0
    }
  ], [
    {
      row_key: 'a',
      sentiment: '正面',
      negative_theme: '',
      reason: '表达认可',
      confidence: 'high'
    },
    {
      row_key: 'b',
      sentiment: '负面',
      negative_theme: '售后服务',
      reason: '抱怨售后',
      confidence: 'medium'
    }
  ]);

  assert.deepEqual(model.summary, {
    total_comments: 3,
    reviewed_comments: 2,
    positive_comments: 1,
    negative_comments: 1,
    neutral_comments: 0,
    missing_review_comments: 1
  });
  assert.equal(model.sheets.allComments.rows.length, 3);
  assert.equal(model.sheets.negativeComments.rows[0].row_key, 'b');
  assert.equal(model.sheets.positiveComments.rows[0].row_key, 'a');
  assert.equal(model.sheets.aiDetails.rows.length, 2);
});

test('writes an xlsx workbook with summary and filtered comment sheets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-report-'));
  const comments = path.join(dir, 'normalized-comments.jsonl');
  const aiReview = path.join(dir, 'ai-review-input');
  const out = path.join(dir, 'comment-report.xlsx');

  fs.mkdirSync(aiReview);
  fs.writeFileSync(comments, [
    JSON.stringify({
      row_key: 'a',
      platform: 'douyin',
      source_url: 'https://example.com/a',
      row_type: 'level1',
      user_name: '用户A',
      text: '画质很好',
      like_count: 3
    }),
    JSON.stringify({
      row_key: 'b',
      platform: 'douyin',
      source_url: 'https://example.com/a',
      row_type: 'level1',
      user_name: '用户B',
      text: '售后<差>&价格贵',
      like_count: 1
    })
  ].join('\n'));
  writeJson(path.join(aiReview, 'review_001.json'), [
    {
      row_key: 'a',
      sentiment: '正面',
      negative_theme: '',
      reason: '表达认可',
      confidence: 'high'
    },
    {
      row_key: 'b',
      sentiment: '负面',
      negative_theme: '售后服务',
      reason: '抱怨售后',
      confidence: 'medium'
    }
  ]);
  writeJson(path.join(aiReview, 'manifest.json'), {
    batches: [
      {
        output_file: path.join(aiReview, 'review_001.json')
      }
    ]
  });

  const result = report.buildExcelReport({
    comments,
    aiReview,
    out
  });
  const bytes = fs.readFileSync(out);

  assert.equal(result.status, 'success');
  assert.equal(result.summary.negative_comments, 1);
  assert.equal(bytes.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');
  assert.equal(bytes.includes(Buffer.from('workbook.xml')), true);
  assert.equal(bytes.includes(Buffer.from('总结')), true);
  assert.equal(bytes.includes(Buffer.from('全部评论')), true);
  assert.equal(bytes.includes(Buffer.from('负面评论')), true);
  assert.equal(bytes.includes(Buffer.from('售后&lt;差&gt;&amp;价格贵')), true);
});

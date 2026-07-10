'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const report = require('../src/normalize/build-weibo-history-semantic-report.js');

const projectRoot = path.resolve(__dirname, '..');

function comment(overrides = {}) {
  return {
    row_key: 'row-1',
    phase: '预热期',
    source_url: 'https://weibo.com/1/A',
    source_excel_row: 7,
    source_index: '1',
    creator_name: '博主A',
    source_engagement_count: 88,
    platform: 'weibo',
    row_type: 'level1',
    user_name: '用户A',
    text: '画质很好',
    created_at: '2026-07-01 09:00',
    ip_location: '北京',
    like_count: 3,
    reply_to_user_name: '',
    root_text: '画质很好',
    raw: {
      source_row: 20,
      post_text: '微博正文不应出现在报表模型中',
    },
    ...overrides,
  };
}

function review(row_key, overrides = {}) {
  return {
    row_key,
    sentiment: '中性',
    negative_theme: '',
    reason: '无明显情绪倾向',
    confidence: 'high',
    ...overrides,
  };
}

test('builds five-sheet Weibo history model with grouped floor rows and aggregates', () => {
  const comments = [
    comment(),
    comment({
      row_key: 'row-2',
      row_type: 'level2',
      user_name: '用户B',
      text: '售后没人处理',
      created_at: '2026-07-01 09:02',
      reply_to_user_name: '用户A',
      root_text: '画质很好',
      raw: { source_row: 21, post_text: '微博正文不应出现在报表模型中' },
    }),
    comment({
      row_key: 'row-3',
      phase: '预热期',
      source_url: 'https://weibo.com/2/B',
      source_excel_row: 12,
      source_index: '2',
      creator_name: '博主B',
      source_engagement_count: 9,
      user_name: '用户C',
      text: '路过看看',
      created_at: '2026-07-02 10:00',
      root_text: '路过看看',
      raw: { source_row: 22, post_text: '另一条微博正文' },
    }),
  ];
  const reviews = [
    review('row-1', { sentiment: '正面', reason: '表达画质认可' }),
    review('row-2', { sentiment: '负面', negative_theme: '售后服务', reason: '投诉售后' }),
    review('row-3'),
  ];

  const model = report.buildWeiboHistoryReportModel(comments, reviews);

  assert.deepEqual(model.sheetNames, ['总结', '按帖子楼层展示', '负面评论', '正面评论', '全部评论语义明细']);
  assert.equal(model.summary.total_comments, 3);
  assert.equal(model.summary.post_count, 2);
  assert.equal(model.summary.level1_comments, 2);
  assert.equal(model.summary.level2_replies, 1);
  assert.equal(model.summary.positive_comments, 1);
  assert.equal(model.summary.negative_comments, 1);
  assert.equal(model.summary.neutral_comments, 1);
  assert.equal(model.summary.negative_rate, 1 / 3);

  assert.equal(model.floorRows[0].record_type, 'post_header');
  assert.match(model.floorRows[0].post_title, /博主：博主A/);
  assert.equal(model.floorRows[0].post_title.includes('微博正文'), false);
  assert.equal(model.floorRows[1].display_text, '画质很好');
  assert.equal(model.floorRows[2].display_text, '↳ 售后没人处理');
  assert.equal(model.floorRows[2].root_text, '画质很好');
  assert.equal(model.floorRows[3].record_type, 'post_header');

  assert.equal(model.negativeRows[0].negative_theme, '售后服务');
  assert.equal(model.positiveRows[0].sentiment, '正面');
  assert.equal(model.detailRows[1].raw.source_row, 21);
  assert.equal(model.phaseRows[0].phase, '预热期');
  assert.equal(model.phaseRows[0].negative_comments, 1);
  assert.equal(model.postRows[0].source_url, 'https://weibo.com/1/A');
  assert.deepEqual(model.themeRows, [{ negative_theme: '售后服务', comment_count: 1 }]);
});

test('sorts post groups without separating replies from their original post order', () => {
  const comments = [
    comment({
      row_key: 'later-root',
      phase: 'B阶段',
      source_url: 'https://weibo.com/9/Z',
      source_excel_row: 20,
      source_index: '9',
      text: '后期根评论',
      root_text: '后期根评论',
      raw: { source_row: 50 },
    }),
    comment({
      row_key: 'early-root',
      phase: 'A阶段',
      source_url: 'https://weibo.com/1/A',
      source_excel_row: 2,
      source_index: '1',
      text: '前期根评论',
      root_text: '前期根评论',
      raw: { source_row: 30 },
    }),
    comment({
      row_key: 'early-reply',
      phase: 'A阶段',
      source_url: 'https://weibo.com/1/A',
      source_excel_row: 2,
      source_index: '1',
      row_type: 'level2',
      text: '前期回复',
      root_text: '前期根评论',
      raw: { source_row: 31 },
    }),
  ];
  const reviews = comments.map(row => review(row.row_key));

  const model = report.buildWeiboHistoryReportModel(comments, reviews);

  assert.equal(model.floorRows[0].phase, 'A阶段');
  assert.equal(model.floorRows[1].row_key, 'early-root');
  assert.equal(model.floorRows[2].row_key, 'early-reply');
  assert.equal(model.floorRows[3].phase, 'B阶段');
});

test('rejects report construction when semantic reviews do not cover every comment', () => {
  assert.throws(
    () => report.buildWeiboHistoryReportModel([comment()], []),
    /语义审阅未覆盖全部评论/,
  );
});

function writeCliFixture(qaStatus) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weibo-history-semantic-report-'));
  const commentsPath = path.join(dir, 'comments.jsonl');
  const reviewsPath = path.join(dir, 'reviews.json');
  const qaPath = path.join(dir, 'semantic-qa-summary.json');
  const outPath = path.join(dir, 'delivery.xlsx');
  const rows = [
    comment({ row_key: 'cli-positive', text: '画质很好' }),
    comment({
      row_key: 'cli-negative',
      row_type: 'level2',
      text: '售后没人处理',
      reply_to_user_name: '用户A',
      root_text: '画质很好',
    }),
  ];
  const reviews = [
    review('cli-positive', { sentiment: '正面', reason: '表达画质认可' }),
    review('cli-negative', { sentiment: '负面', negative_theme: '售后服务', reason: '投诉售后' }),
  ];

  fs.writeFileSync(commentsPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(reviewsPath, `${JSON.stringify(reviews)}\n`);
  fs.writeFileSync(qaPath, `${JSON.stringify({ status: qaStatus })}\n`);

  return { dir, commentsPath, reviewsPath, qaPath, outPath };
}

function runRenderer(fixture) {
  return spawnSync(process.execPath, [
    'script/build-weibo-history-semantic-report.mjs',
    '--comments', fixture.commentsPath,
    '--ai-review', fixture.reviewsPath,
    '--qa', fixture.qaPath,
    '--out', fixture.outPath,
  ], { cwd: projectRoot, encoding: 'utf8' });
}

test('rejects failed semantic QA without writing delivery.xlsx', () => {
  const fixture = writeCliFixture('failed');
  const result = runRenderer(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /语义 QA 未通过/);
  assert.equal(fs.existsSync(fixture.outPath), false);
});

test('exports five ordered semantic sheets with bounded summary formulas and previews', async () => {
  const fixture = writeCliFixture('ok');
  const result = runRenderer(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(fixture.outPath), true);

  for (const sheetName of report.SHEET_NAMES) {
    assert.equal(fs.existsSync(path.join(fixture.dir, `delivery-preview-${sheetName}.png`)), true);
  }

  const { FileBlob, SpreadsheetFile } = await import('@oai/artifact-tool');
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fixture.outPath));
  assert.deepEqual(workbook.worksheets.items.map(sheet => sheet.name), report.SHEET_NAMES);

  const summary = workbook.worksheets.getItem('总结');
  const totalFormula = summary.getRange('B4').formulas[0][0];
  assert.match(totalFormula, /^=COUNTA\('全部评论语义明细'!\$A\$2:\$A\$3\)$/);
  assert.equal(totalFormula.includes('$A:$A'), false);
  assert.equal(summary.getRange('B11').values[0][0], 1);

  const floors = workbook.worksheets.getItem('按帖子楼层展示');
  const values = floors.getRange('A1:K4').values;
  assert.match(String(values[1][0]), /^博主：博主A｜阶段：预热期｜互动量：88｜链接：https:\/\/weibo\.com\/1\/A$/);
  assert.equal(values[3][1], '↳ 售后没人处理');
});

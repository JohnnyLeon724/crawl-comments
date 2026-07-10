#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const require = createRequire(import.meta.url);
const reportBuilder = require('../src/normalize/build-weibo-history-semantic-report.js');

const DETAIL_COLUMNS = [
  ['row_key', 'row_key', 24],
  ['phase', '阶段', 14],
  ['source_url', '微博链接', 42],
  ['source_excel_row', '来源行', 10],
  ['source_index', '微博序号', 12],
  ['creator_name', '博主', 16],
  ['source_engagement_count', '互动量', 12],
  ['row_type', '层级', 10],
  ['user_name', '评论人', 16],
  ['text', '评论内容', 44],
  ['created_at', '评论时间', 20],
  ['ip_location', 'IP属地', 14],
  ['like_count', '点赞数', 10],
  ['sentiment', '情感', 10],
  ['negative_theme', '负面主题', 14],
  ['reason', '语义依据', 32],
  ['confidence', '置信度', 10],
  ['reply_to_user_name', '回复对象', 16],
  ['root_text', '一级评论上下文', 40],
  ['source_row', '原始评论行', 12],
];

const COMMENT_COLUMNS = [
  ['row_key', 'row_key', 24],
  ['phase', '阶段', 14],
  ['source_url', '微博链接', 42],
  ['creator_name', '博主', 16],
  ['row_type', '层级', 10],
  ['user_name', '评论人', 16],
  ['text', '评论内容', 44],
  ['created_at', '评论时间', 20],
  ['like_count', '点赞数', 10],
  ['reply_to_user_name', '回复对象', 16],
  ['root_text', '一级评论上下文', 40],
  ['sentiment', '情感', 10],
  ['negative_theme', '负面主题', 14],
  ['reason', '语义依据', 32],
  ['confidence', '置信度', 10],
];

const FLOOR_HEADERS = ['阶段', '评论内容', '层级', '评论人', '回复对象', '时间', '点赞', '情感', '负面主题', '语义依据', '置信度'];
const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function usage() {
  return [
    '用法：',
    '  node script/build-weibo-history-semantic-report.mjs --comments all-normalized-comments.jsonl --ai-review ai-review-input --qa semantic-qa-summary.json --out delivery.xlsx',
    '',
    '参数：',
    '  --comments   必填，历史导入的规范评论 JSONL',
    '  --ai-review  必填，语义审阅 JSON 数组或审阅目录',
    '  --qa         必填，语义 QA 汇总 JSON',
    '  --out        必填，正式 delivery.xlsx 输出路径',
    '  --help       查看帮助',
  ].join('\n');
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`);
  return value;
}

function parseArgs(argv) {
  const args = { comments: '', aiReview: '', qa: '', out: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--comments') {
      args.comments = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--ai-review') {
      args.aiReview = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--qa') {
      args.qa = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--out') {
      args.out = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${token}`);
  }
  if (args.help) return args;
  for (const [flag, value] of Object.entries({ '--comments': args.comments, '--ai-review': args.aiReview, '--qa': args.qa, '--out': args.out })) {
    if (!value) throw new Error(`必须提供 ${flag}`);
  }
  return args;
}

function readJsonl(filePath) {
  return fsSync.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function normalizeReviewRows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.results)) return value.results;
  if (value && Array.isArray(value.rows)) return value.rows;
  throw new Error('语义审阅输出必须是 JSON 数组、results 或 rows');
}

function readJson(filePath) {
  return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
}

function resolveReviewPath(baseDir, rawPath) {
  const value = String(rawPath || '');
  if (path.isAbsolute(value)) return value;
  if (fsSync.existsSync(value)) return value;
  return path.join(baseDir, value);
}

function readAiReviewRows(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = fsSync.statSync(resolved);
  if (stat.isFile()) return normalizeReviewRows(readJson(resolved));

  const manifestPath = path.join(resolved, 'manifest.json');
  const candidateFiles = [];
  if (fsSync.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    for (const batch of Array.isArray(manifest.batches) ? manifest.batches : []) {
      if (!batch?.output_file) continue;
      const outputFile = resolveReviewPath(path.dirname(manifestPath), batch.output_file);
      if (fsSync.existsSync(outputFile)) candidateFiles.push(outputFile);
    }
  }
  if (!candidateFiles.length) {
    for (const entry of fsSync.readdirSync(resolved).sort()) {
      if (/^review_\d+\.json$/i.test(entry)) candidateFiles.push(path.join(resolved, entry));
    }
  }
  if (!candidateFiles.length) throw new Error(`未找到语义审阅输出：${inputPath}`);
  return candidateFiles.flatMap(filePath => normalizeReviewRows(readJson(filePath)));
}

function assertQaOk(qa) {
  if (qa?.status !== 'ok') throw new Error('语义 QA 未通过，拒绝生成正式 delivery.xlsx');
}

function cellValue(row, field) {
  if (field === 'source_row') return row.raw?.source_row ?? '';
  const value = row[field];
  return value == null ? '' : value;
}

function endColumn(columnCount) {
  if (columnCount > COLUMN_LETTERS.length) throw new Error('当前报表列数超出支持范围');
  return COLUMN_LETTERS[columnCount - 1];
}

function applyHeader(range) {
  range.format = {
    fill: '#1F4E78',
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'outside', style: 'thin', color: '#9FBAD0' },
  };
  range.format.rowHeight = 28;
}

function applyTitle(range) {
  range.format = {
    fill: '#D9EAF7',
    font: { bold: true, color: '#17365D', size: 14 },
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'outside', style: 'thin', color: '#9FBAD0' },
  };
  range.format.rowHeight = 28;
}

function setColumnWidths(sheet, lastRow, columns) {
  for (let index = 0; index < columns.length; index += 1) {
    sheet.getRange(`${COLUMN_LETTERS[index]}1:${COLUMN_LETTERS[index]}${lastRow}`).format.columnWidth = columns[index][2];
  }
}

function writeRowsSheet(sheet, columns, rows, tableName) {
  const lastColumn = endColumn(columns.length);
  const lastRow = Math.max(1, rows.length + 1);
  sheet.showGridLines = false;
  sheet.getRange(`A1:${lastColumn}1`).values = [columns.map(column => column[1])];
  applyHeader(sheet.getRange(`A1:${lastColumn}1`));
  if (rows.length) {
    sheet.getRange(`A2:${lastColumn}${lastRow}`).values = rows.map(row => columns.map(([field]) => cellValue(row, field)));
    const dataRange = sheet.getRange(`A2:${lastColumn}${lastRow}`);
    dataRange.format.wrapText = true;
    dataRange.format.verticalAlignment = 'top';
    dataRange.format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
    const sentimentColumn = columns.findIndex(([field]) => field === 'sentiment');
    if (sentimentColumn >= 0) {
      const sentimentLetter = COLUMN_LETTERS[sentimentColumn];
      dataRange.conditionalFormats.add('Custom', {
        formula: `=$${sentimentLetter}2=\"负面\"`,
        format: { fill: '#FDE9E7', font: { color: '#9C0006' } },
      });
      dataRange.conditionalFormats.add('Custom', {
        formula: `=$${sentimentLetter}2=\"正面\"`,
        format: { fill: '#E2F0D9', font: { color: '#375623' } },
      });
    }
    sheet.tables.add(`A1:${lastColumn}${lastRow}`, true, tableName);
  }
  setColumnWidths(sheet, lastRow, columns);
  sheet.freezePanes.freezeRows(1);
  return { lastRow, lastColumn };
}

function detailRange(columnLetter, detailLastRow) {
  return `'全部评论语义明细'!$${columnLetter}$2:$${columnLetter}$${detailLastRow}`;
}

function writeSummarySheet(summary, model, detailLastRow) {
  summary.showGridLines = false;
  summary.mergeCells('A1:B1');
  summary.getRange('A1').values = [['微博历史评论语义分析汇总']];
  applyTitle(summary.getRange('A1:B1'));
  summary.getRange('A3:B3').values = [['核心指标', '数值']];
  applyHeader(summary.getRange('A3:B3'));
  summary.getRange('A4:A13').values = [
    ['总评论数'],
    ['一级评论数'],
    ['二级回复数'],
    ['正面评论数'],
    ['负面评论数'],
    ['负面率'],
    ['中性评论数'],
    ['微博数'],
    ['分析范围'],
    ['微博正文'],
  ];
  summary.getRange('B4:B13').formulas = [
    [`=COUNTA(${detailRange('A', detailLastRow)})`],
    [`=COUNTIF(${detailRange('H', detailLastRow)},\"level1\")`],
    [`=COUNTIF(${detailRange('H', detailLastRow)},\"level2\")`],
    [`=COUNTIF(${detailRange('N', detailLastRow)},\"正面\")`],
    [`=COUNTIF(${detailRange('N', detailLastRow)},\"负面\")`],
    ['=IFERROR(B8/B4,0)'],
    [`=COUNTIF(${detailRange('N', detailLastRow)},\"中性\")`],
    [`=COUNTA(I4:I${Math.max(4, 3 + model.postRows.length)})`],
    ['=B4&\" 条历史导入评论（不混入 Chrome 测试样本）\"'],
    ['=\"历史输入未提供，按约定不补读\"'],
  ];
  summary.getRange('B9').format.numberFormat = '0.0%';
  summary.getRange('A3:B13').format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
  summary.getRange('A4:A13').format.font = { bold: true, color: '#17365D' };
  summary.getRange('A1:A13').format.columnWidth = 18;
  summary.getRange('B1:B13').format.columnWidth = 44;
  summary.getRange('B12:B13').format.wrapText = true;

  const phaseStart = 3;
  summary.getRange(`D${phaseStart}:G${phaseStart}`).values = [['阶段', '评论数', '负面数', '负面率']];
  applyHeader(summary.getRange(`D${phaseStart}:G${phaseStart}`));
  const phaseRows = model.phaseRows;
  if (phaseRows.length) {
    const phaseEnd = phaseStart + phaseRows.length;
    summary.getRange(`D${phaseStart + 1}:D${phaseEnd}`).values = phaseRows.map(row => [row.phase]);
    summary.getRange(`E${phaseStart + 1}:G${phaseEnd}`).formulas = phaseRows.map((_, offset) => {
      const rowNumber = phaseStart + 1 + offset;
      return [
        `=COUNTIF(${detailRange('B', detailLastRow)},D${rowNumber})`,
        `=COUNTIFS(${detailRange('B', detailLastRow)},D${rowNumber},${detailRange('N', detailLastRow)},\"负面\")`,
        `=IFERROR(F${rowNumber}/E${rowNumber},0)`,
      ];
    });
    summary.getRange(`G${phaseStart + 1}:G${phaseEnd}`).format.numberFormat = '0.0%';
    summary.getRange(`D${phaseStart}:G${phaseEnd}`).format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
  }

  const themeStart = Math.max(phaseStart + phaseRows.length + 3, 8);
  summary.getRange(`D${themeStart}:E${themeStart}`).values = [['负面主题', '评论数']];
  applyHeader(summary.getRange(`D${themeStart}:E${themeStart}`));
  if (model.themeRows.length) {
    const themeEnd = themeStart + model.themeRows.length;
    summary.getRange(`D${themeStart + 1}:D${themeEnd}`).values = model.themeRows.map(row => [row.negative_theme]);
    summary.getRange(`E${themeStart + 1}:E${themeEnd}`).formulas = model.themeRows.map((_, offset) => {
      const rowNumber = themeStart + 1 + offset;
      return [`=COUNTIFS(${detailRange('O', detailLastRow)},D${rowNumber},${detailRange('N', detailLastRow)},\"负面\")`];
    });
    summary.getRange(`D${themeStart}:E${themeEnd}`).format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
  }

  const postStart = 3;
  summary.getRange(`I${postStart}:L${postStart}`).values = [['微博链接', '评论数', '负面数', '负面率']];
  applyHeader(summary.getRange(`I${postStart}:L${postStart}`));
  if (model.postRows.length) {
    const postEnd = postStart + model.postRows.length;
    summary.getRange(`I${postStart + 1}:I${postEnd}`).values = model.postRows.map(row => [row.source_url]);
    summary.getRange(`J${postStart + 1}:L${postEnd}`).formulas = model.postRows.map((_, offset) => {
      const rowNumber = postStart + 1 + offset;
      return [
        `=COUNTIF(${detailRange('C', detailLastRow)},I${rowNumber})`,
        `=COUNTIFS(${detailRange('C', detailLastRow)},I${rowNumber},${detailRange('N', detailLastRow)},\"负面\")`,
        `=IFERROR(K${rowNumber}/J${rowNumber},0)`,
      ];
    });
    summary.getRange(`L${postStart + 1}:L${postEnd}`).format.numberFormat = '0.0%';
    summary.getRange(`I${postStart}:L${postEnd}`).format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
  }
  summary.getRange('D1:D20').format.columnWidth = 18;
  summary.getRange('E1:G20').format.columnWidth = 12;
  summary.getRange('I1:I20').format.columnWidth = 42;
  summary.getRange('J1:L20').format.columnWidth = 12;
}

function writeFloorSheet(sheet, floorRows) {
  const lastRow = Math.max(1, floorRows.length + 1);
  sheet.showGridLines = false;
  sheet.getRange('A1:K1').values = [FLOOR_HEADERS];
  applyHeader(sheet.getRange('A1:K1'));
  if (floorRows.length) {
    const values = floorRows.map(row => {
      if (row.record_type === 'post_header') return [row.post_title, '', '', '', '', '', '', '', '', '', ''];
      return [
        row.phase,
        row.display_text,
        row.row_type,
        row.user_name,
        row.reply_to_user_name,
        row.created_at,
        row.like_count,
        row.sentiment,
        row.negative_theme,
        row.reason,
        row.confidence,
      ];
    });
    sheet.getRange(`A2:K${lastRow}`).values = values;
    for (let index = 0; index < floorRows.length; index += 1) {
      const rowNumber = index + 2;
      const row = floorRows[index];
      if (row.record_type === 'post_header') {
        sheet.mergeCells(`A${rowNumber}:K${rowNumber}`);
        const title = sheet.getRange(`A${rowNumber}:K${rowNumber}`);
        title.format = {
          fill: '#D9EAF7',
          font: { bold: true, color: '#17365D' },
          wrapText: true,
          verticalAlignment: 'center',
          borders: { preset: 'outside', style: 'thin', color: '#9FBAD0' },
        };
        title.format.rowHeight = 26;
      }
    }
    const allFloorRows = sheet.getRange(`A2:K${lastRow}`);
    allFloorRows.format.wrapText = true;
    allFloorRows.format.verticalAlignment = 'top';
    allFloorRows.conditionalFormats.add('Custom', {
      formula: '=$H2="负面"',
      format: { fill: '#FDE9E7', font: { color: '#9C0006' } },
    });
    allFloorRows.conditionalFormats.add('Custom', {
      formula: '=$H2="正面"',
      format: { fill: '#E2F0D9', font: { color: '#375623' } },
    });
  }
  const widths = [14, 48, 10, 16, 16, 20, 10, 10, 14, 32, 10];
  for (let index = 0; index < widths.length; index += 1) {
    sheet.getRange(`${COLUMN_LETTERS[index]}1:${COLUMN_LETTERS[index]}${lastRow}`).format.columnWidth = widths[index];
  }
  sheet.freezePanes.freezeRows(1);
}

async function renderWorkbook(workbook, outputDirectory) {
  for (const sheetName of reportBuilder.SHEET_NAMES) {
    const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
    const bytes = new Uint8Array(await preview.arrayBuffer());
    await fs.writeFile(path.join(outputDirectory, `delivery-preview-${sheetName}.png`), bytes);
  }
}

async function buildDelivery(args) {
  const qa = readJson(args.qa);
  assertQaOk(qa);

  const comments = readJsonl(args.comments);
  const reviews = readAiReviewRows(args.aiReview);
  const model = reportBuilder.buildWeiboHistoryReportModel(comments, reviews);
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add('总结');
  const floors = workbook.worksheets.add('按帖子楼层展示');
  const negative = workbook.worksheets.add('负面评论');
  const positive = workbook.worksheets.add('正面评论');
  const detail = workbook.worksheets.add('全部评论语义明细');

  const detailInfo = writeRowsSheet(detail, DETAIL_COLUMNS, model.detailRows, 'WeiboSemanticDetail');
  writeFloorSheet(floors, model.floorRows);
  writeRowsSheet(negative, COMMENT_COLUMNS, model.negativeRows, 'WeiboNegativeComments');
  writeRowsSheet(positive, COMMENT_COLUMNS, model.positiveRows, 'WeiboPositiveComments');
  writeSummarySheet(summary, model, Math.max(2, detailInfo.lastRow));

  const outputDirectory = path.dirname(path.resolve(args.out));
  await fs.mkdir(outputDirectory, { recursive: true });
  await renderWorkbook(workbook, outputDirectory);
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(args.out);
  return { output: path.resolve(args.out), sheetNames: model.sheetNames };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return null;
    }
    const result = await buildDelivery(args);
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { assertQaOk, buildDelivery, parseArgs, readAiReviewRows, readJsonl };

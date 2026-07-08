#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const douyin = require('../adapters/douyin.js');
const xiaohongshu = require('../adapters/xiaohongshu.js');

function printUsage() {
  console.log(`
用法：
  node script/normalize-ai-comment-extraction.js --run-dir output/run_001 --platform douyin
  node script/normalize-ai-comment-extraction.js --input ai-comment-extraction.json --snapshot comment-dom-snapshot.json --out normalized-comments.jsonl --platform douyin
  node script/normalize-ai-comment-extraction.js --input ai-comment-extraction.json --batch comment-dom-batch.json --out normalized-comments.jsonl

参数：
  --run-dir     可选，自动推导 ai-comment-extraction.json、comment-dom-snapshot.json、normalized-comments.jsonl
  --input       可选，AI 结构化输出 JSON；未使用 --run-dir 时必填
  --snapshot    可选，DOM snapshot JSON；未使用 --run-dir 时建议提供
  --batch       可选，DOM candidate batch JSON；与 --snapshot 二选一
  --task        可选，客户任务上下文 JSON；使用 --run-dir 时默认读取 task.json
  --out         可选，normalized-comments.jsonl 输出路径；未使用 --run-dir 时必填
  --platform    可选，douyin 或 xiaohongshu；未传时读取 AI 输出 platform
  --source-url  可选，源 URL；未传时读取 AI 输出 source_url
  --help        查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要一个值`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    runDir: '',
    input: '',
    snapshot: '',
    batch: '',
    task: '',
    out: '',
    platform: '',
    sourceUrl: '',
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--run-dir') {
      args.runDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--input') {
      args.input = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--snapshot') {
      args.snapshot = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--batch') {
      args.batch = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--task') {
      args.task = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out') {
      args.out = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--platform') {
      args.platform = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--source-url') {
      args.sourceUrl = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;

  if (args.runDir) {
    args.input = args.input || path.join(args.runDir, 'ai-comment-extraction.json');
    args.snapshot = args.snapshot || path.join(args.runDir, 'comment-dom-snapshot.json');
    args.task = args.task || path.join(args.runDir, 'task.json');
    args.out = args.out || path.join(args.runDir, 'normalized-comments.jsonl');
  }

  if (!args.input) throw new Error('必须提供 --input 或 --run-dir');
  if (!args.out) throw new Error('必须提供 --out 或 --run-dir');

  return args;
}

function normalizeSpaces(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return normalizeSpaces(value).replace(/\s+/g, '');
}

function buildRowKey(parts) {
  return crypto
    .createHash('sha1')
    .update(parts.map(part => compact(part)).join('|'))
    .digest('hex');
}

function extractPostId(platform, sourceUrl) {
  if (platform === 'douyin') return douyin.extractDouyinPostId(sourceUrl);
  if (platform === 'xiaohongshu') return xiaohongshu.extractXiaohongshuNoteId(sourceUrl);
  return '';
}

function buildChunkMap(snapshot) {
  const map = new Map();
  const chunks = Array.isArray(snapshot && snapshot.chunks) ? snapshot.chunks : [];
  const candidates = Array.isArray(snapshot && snapshot.candidates) ? snapshot.candidates : [];

  for (const chunk of chunks) {
    if (chunk && chunk.chunk_id) map.set(String(chunk.chunk_id), chunk);
  }

  for (const candidate of candidates) {
    if (candidate && candidate.candidate_id) map.set(String(candidate.candidate_id), candidate);
  }

  return map;
}

function getSnapshotBatchId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  if (snapshot.schema_version !== 'comment-dom-batch-v1') return '';
  return normalizeSpaces(snapshot.batch_id);
}

function normalizeTaskContext(task) {
  if (!task || typeof task !== 'object') return null;

  return {
    task_id: normalizeSpaces(task.task_id),
    phase: normalizeSpaces(task.phase),
    source_excel_row: Number.isInteger(task.source_excel_row) ? task.source_excel_row : 0,
    source_index: normalizeSpaces(task.source_index),
    creator_name: normalizeSpaces(task.creator_name),
    published_at_text: normalizeSpaces(task.published_at_text),
    source_engagement_count: Number.isFinite(Number(task.engagement_count)) ? Number(task.engagement_count) : 0,
    source_expected_comment_count: Number.isFinite(Number(task.expected_comment_count)) ? Number(task.expected_comment_count) : 0
  };
}

function normalizeAiRow(row, options) {
  const text = normalizeSpaces(row && row.text);
  if (!text) return null;

  const platform = options.platform || 'unknown';
  const sourceUrl = options.sourceUrl || '';
  const rowType = row.row_type === 'level2' ? 'level2' : 'level1';
  const userName = normalizeSpaces(row.user_name);
  const sourceChunkId = normalizeSpaces(row.source_chunk_id);
  const keyParts = [
    platform,
    sourceUrl,
    rowType,
    sourceChunkId,
    userName,
    text
  ];
  const sourceBatchId = normalizeSpaces(options.sourceBatchId);
  if (sourceBatchId) keyParts.push(sourceBatchId);
  const rowKey = buildRowKey(keyParts);
  const sourceChunk = options.chunkMap.get(sourceChunkId) || null;
  const taskContext = normalizeTaskContext(options.task);
  const rawTask = options.task && typeof options.task === 'object'
    ? Object.assign({}, options.task)
    : null;

  return {
    row_key: rowKey,
    task_id: taskContext ? taskContext.task_id : '',
    phase: taskContext ? taskContext.phase : '',
    source_excel_row: taskContext ? taskContext.source_excel_row : 0,
    source_index: taskContext ? taskContext.source_index : '',
    creator_name: taskContext ? taskContext.creator_name : '',
    published_at_text: taskContext ? taskContext.published_at_text : '',
    source_engagement_count: taskContext ? taskContext.source_engagement_count : 0,
    source_expected_comment_count: taskContext ? taskContext.source_expected_comment_count : 0,
    platform,
    source_url: sourceUrl,
    post_id: extractPostId(platform, sourceUrl),
    row_type: rowType,
    comment_id: '',
    root_comment_id: rowType === 'level1' ? rowKey : '',
    parent_comment_id: '',
    user_name: userName,
    text,
    created_at: normalizeSpaces(row.created_at),
    like_count: Number.isInteger(row.like_count) && row.like_count >= 0 ? row.like_count : 0,
    reply_to_user_name: normalizeSpaces(row.reply_to_user_name),
    root_text: rowType === 'level1' ? text : normalizeSpaces(row.root_text),
    raw: {
      ai_row: Object.assign({}, row),
      task: rawTask,
      source_chunk: sourceChunk,
      source_batch_id: sourceBatchId,
      source_candidate_id: sourceBatchId ? sourceChunkId : '',
      snapshot_file: options.snapshotFile || ''
    }
  };
}

function normalizeAiExtraction(extraction, options = {}) {
  const platform = options.platform || extraction.platform || 'unknown';
  const sourceUrl = options.sourceUrl || extraction.source_url || '';
  const snapshot = options.snapshot || {};
  const chunkMap = buildChunkMap(snapshot);
  const sourceBatchId = options.sourceBatchId || getSnapshotBatchId(snapshot);
  const seen = new Set();
  const rows = [];

  for (const item of Array.isArray(extraction.rows) ? extraction.rows : []) {
    const row = normalizeAiRow(item || {}, {
      platform,
      sourceUrl,
      chunkMap,
      task: options.task || null,
      snapshotFile: options.snapshotFile || '',
      sourceBatchId
    });
    if (!row || seen.has(row.row_key)) continue;
    seen.add(row.row_key);
    rows.push(row);
  }

  return rows;
}

function rowsToJsonl(rows) {
  if (!rows.length) return '';
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeFile(args) {
  const extraction = readJson(args.input);
  const sourceDomFile = args.batch || args.snapshot || '';
  const snapshot = sourceDomFile && fs.existsSync(sourceDomFile)
    ? readJson(sourceDomFile)
    : {};
  const task = args.task && fs.existsSync(args.task)
    ? readJson(args.task)
    : null;
  const rows = normalizeAiExtraction(extraction, {
    snapshot,
    snapshotFile: sourceDomFile,
    task,
    platform: args.platform || extraction.platform || '',
    sourceUrl: args.sourceUrl || extraction.source_url || ''
  });

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, rowsToJsonl(rows));

  return {
    status: 'success',
    platform: args.platform || extraction.platform || 'unknown',
    input: args.input,
    snapshot: args.snapshot || '',
    batch: args.batch || '',
    task: args.task || '',
    out: args.out,
    rowCount: rows.length,
    rejectedCount: Array.isArray(extraction.rejected) ? extraction.rejected.length : 0
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return null;
  }

  if (args.help) {
    printUsage();
    return null;
  }

  const summary = normalizeFile(args);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizeSpaces,
  buildRowKey,
  extractPostId,
  buildChunkMap,
  getSnapshotBatchId,
  normalizeAiRow,
  normalizeAiExtraction,
  rowsToJsonl,
  normalizeFile,
  main
};
